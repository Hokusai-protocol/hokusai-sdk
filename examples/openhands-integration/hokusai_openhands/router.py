from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from .contribution import INTEGRATION_VERSION, RouteContext
from .errors import ModelUnavailableError, RoutingUnavailableError
from .hokusai_client import HokusaiHttpClient
from .metadata import build_routing_metadata
from .models import allowed_model_ids, list_runnable_models, map_recommendation_to_runnable_model

OPENHANDS_SDK_AVAILABLE = False

if TYPE_CHECKING:

    class _RouterLLMBase:
        def __init__(
            self,
            *,
            router_name: str,
            llms_for_routing: Mapping[str, Any],
            model: str,
        ) -> None:
            if not llms_for_routing:
                raise ValueError("llms_for_routing cannot be empty")
            self.router_name = router_name
            self.llms_for_routing = dict(llms_for_routing)
            self.model = model
            self.active_llm: Any | None = None

        def completion(self, messages: list[Any], **kwargs: Any) -> Any:
            selected = self.select_llm(messages)
            self.active_llm = self.llms_for_routing[selected]
            return self.active_llm.completion(messages=messages, **kwargs)

        def __getattr__(self, name: str) -> Any:
            fallback_llm = next(iter(self.llms_for_routing.values()))
            return getattr(fallback_llm, name)
else:
    try:
        from openhands.sdk.llm.router.base import RouterLLM as _RouterLLMBase

        OPENHANDS_SDK_AVAILABLE = True
    except Exception:  # pragma: no cover - exercised with the real SDK installed
        OPENHANDS_SDK_AVAILABLE = False

        class _RouterLLMBase:
            def __init__(
                self,
                *,
                router_name: str,
                llms_for_routing: Mapping[str, Any],
                model: str,
            ) -> None:
                if not llms_for_routing:
                    raise ValueError("llms_for_routing cannot be empty")
                self.router_name = router_name
                self.llms_for_routing = dict(llms_for_routing)
                self.model = model
                self.active_llm: Any | None = None

            def completion(self, messages: list[Any], **kwargs: Any) -> Any:
                selected = self.select_llm(messages)
                self.active_llm = self.llms_for_routing[selected]
                return self.active_llm.completion(messages=messages, **kwargs)

            def __getattr__(self, name: str) -> Any:
                fallback_llm = next(iter(self.llms_for_routing.values()))
                return getattr(fallback_llm, name)


MetadataProvider = Callable[[Sequence[Any]], Mapping[str, Any] | None]


class HokusaiRouterLLM(_RouterLLMBase):
    def __init__(
        self,
        *,
        client: HokusaiHttpClient,
        llms_for_routing: Mapping[str, Any],
        metadata_provider: MetadataProvider | None = None,
        fallback_model: str | None = None,
        router_name: str = "hokusai_router",
        request_id_factory: Callable[[], str] | None = None,
    ) -> None:
        resolved_models = dict(llms_for_routing)
        super().__init__(
            router_name=router_name,
            llms_for_routing=resolved_models,
            model=router_name,
        )
        self._client = client
        self._metadata_provider = metadata_provider or (lambda _: {})
        self._fallback_model = fallback_model
        self._request_id_factory = request_id_factory or (lambda: uuid4().hex)
        self.last_route_context: RouteContext | None = None

    def _allowed_models(self) -> list[str]:
        return allowed_model_ids(list_runnable_models(self.llms_for_routing))

    def _fallback_context(
        self,
        *,
        route_id: str | None,
        idempotency_key: str,
        routing_metadata: dict[str, Any],
        error_type: str,
        recommended_model: str | None = None,
    ) -> RouteContext:
        if self._fallback_model is None:
            return RouteContext(
                route_id=route_id,
                selected_model=None,
                selected_key=None,
                selected_usage_id=None,
                allowed_models=self._allowed_models(),
                fallback_used=False,
                recommended_model=recommended_model,
                idempotency_key=idempotency_key,
                routing_metadata=routing_metadata,
                error_type=error_type,
            )

        fallback = map_recommendation_to_runnable_model(
            self._fallback_model,
            self.llms_for_routing,
            fallback_model=self._fallback_model,
        )
        return RouteContext(
            route_id=route_id,
            selected_model=fallback.model_id,
            selected_key=fallback.key,
            selected_usage_id=fallback.usage_id,
            allowed_models=self._allowed_models(),
            fallback_used=True,
            recommended_model=recommended_model,
            idempotency_key=idempotency_key,
            routing_metadata=routing_metadata,
            error_type=error_type,
        )

    def select_llm(self, messages: list[Any]) -> str:
        raw_metadata = self._metadata_provider(messages) or {}
        safe_metadata = build_routing_metadata(
            raw_metadata,
            candidate_models=self._allowed_models(),
            messages=messages,
            integration_version=INTEGRATION_VERSION,
        )
        routing_metadata = dict(safe_metadata)
        idempotency_key = self._request_id_factory()

        try:
            recommendation = self._client.route(
                safe_metadata,
                request_id=idempotency_key,
                idempotency_key=idempotency_key,
            )
        except RoutingUnavailableError as exc:
            self.last_route_context = self._fallback_context(
                route_id=None,
                idempotency_key=idempotency_key,
                routing_metadata=routing_metadata,
                error_type=type(exc).__name__,
            )
            if self.last_route_context.selected_key is None:
                raise
            return self.last_route_context.selected_key

        try:
            selection = map_recommendation_to_runnable_model(
                recommendation.model,
                self.llms_for_routing,
                fallback_model=self._fallback_model,
            )
        except ModelUnavailableError as exc:
            self.last_route_context = self._fallback_context(
                route_id=recommendation.route_id,
                idempotency_key=idempotency_key,
                routing_metadata=routing_metadata,
                error_type=type(exc).__name__,
                recommended_model=recommendation.model,
            )
            if self.last_route_context.selected_key is None:
                raise
            return self.last_route_context.selected_key

        self.last_route_context = RouteContext(
            route_id=recommendation.route_id,
            selected_model=selection.model_id,
            selected_key=selection.key,
            selected_usage_id=selection.usage_id,
            allowed_models=self._allowed_models(),
            fallback_used=selection.fallback_used,
            recommended_model=selection.recommended_model,
            idempotency_key=idempotency_key,
            routing_metadata=routing_metadata,
        )
        return selection.key
