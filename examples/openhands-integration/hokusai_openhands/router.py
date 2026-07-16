from __future__ import annotations

import logging
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import uuid4

from .contribution import INTEGRATION_VERSION
from .errors import (
    ConfigurationError,
    ModelUnavailableError,
    PromptLeakageError,
    RoutingCallFailed,
)
from .hokusai_client import HokusaiHttpClient, Recommendation
from .metadata import SafeRoutingMetadata, build_routing_metadata

LOGGER = logging.getLogger(__name__)

UnavailablePolicy = Literal["decline", "fallback"]

KNOWN_PROVIDER_PREFIXES = (
    "openrouter/",
    "litellm/",
    "openai/",
    "anthropic/",
    "azure/",
    "google/",
    "gemini/",
)


def canonical_model_id(model: str | None) -> str | None:
    if model is None:
        return None
    normalized = model.strip().lower()
    for _ in range(5):
        prefix = next(
            (
                value
                for value in KNOWN_PROVIDER_PREFIXES
                if normalized.startswith(value)
            ),
            None,
        )
        if prefix is None:
            break
        normalized = normalized[len(prefix):]
    return normalized or None


@dataclass(frozen=True)
class ModelBinding:
    """A configured OpenHands routing key and the underlying model id it runs.

    ``key`` is the string returned to OpenHands ``select_llm()`` (a key of
    ``llms_for_routing``). ``model_id`` is the underlying model, used for
    Hokusai ``candidate_models`` and matched against Hokusai recommendations.
    """

    key: str
    model_id: str

    def matches(self, candidate: str) -> bool:
        canonical = canonical_model_id(candidate)
        if canonical is None:
            return False
        return canonical in {
            canonical_model_id(self.model_id),
            canonical_model_id(self.key),
        }


@dataclass(frozen=True)
class RouteDecision:
    """Result of routing a single OpenHands call through Hokusai."""

    call_id: str
    binding: ModelBinding
    recommendation: Recommendation
    fallback_used: bool
    fallback_reason: str | None
    routing_metadata: Mapping[str, Any]

    @property
    def routing_key(self) -> str:
        return self.binding.key

    @property
    def model_id(self) -> str:
        return self.binding.model_id

    @property
    def route_id(self) -> str:
        return self.recommendation.route_id


@dataclass
class HokusaiRouteResolver:
    """Pure routing logic, decoupled from the OpenHands ``RouterLLM`` base class.

    Instances are safe to use across overlapping calls: each call generates a
    fresh ``call_id`` and route state is stored in a lock-guarded dict, keyed
    by the call id. Callers correlate a routing decision with its telemetry by
    stashing the decision or its call id on the request context.
    """

    client: HokusaiHttpClient
    bindings: list[ModelBinding]
    fallback_key: str | None = None
    unavailable_policy: UnavailablePolicy = "decline"
    latency_budget_ms: int | None = None
    budget_usd: float | None = None
    integration_version: str = INTEGRATION_VERSION
    task_metadata_provider: Any = None  # callable | None; resolved at call time
    _state: dict[str, RouteDecision] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def __post_init__(self) -> None:
        if not self.bindings:
            raise ConfigurationError("At least one ModelBinding is required")
        keys = [binding.key for binding in self.bindings]
        if len(set(keys)) != len(keys):
            raise ConfigurationError(f"Duplicate routing keys: {keys}")
        if self.unavailable_policy not in ("decline", "fallback"):
            raise ConfigurationError(
                f"Unknown unavailable_policy: {self.unavailable_policy!r}"
            )
        if self.unavailable_policy == "fallback" and self.fallback_key is None:
            raise ConfigurationError(
                "unavailable_policy='fallback' requires a fallback_key"
            )
        if self.fallback_key is not None and not any(
            binding.key == self.fallback_key for binding in self.bindings
        ):
            raise ConfigurationError(
                f"fallback_key {self.fallback_key!r} is not a configured routing key"
            )

    def routing_keys(self) -> list[str]:
        return [binding.key for binding in self.bindings]

    def candidate_model_ids(self) -> list[str]:
        return [binding.model_id for binding in self.bindings]

    def _match_binding(self, recommendation: str | None) -> ModelBinding | None:
        if not recommendation:
            return None
        for binding in self.bindings:
            if binding.matches(recommendation):
                return binding
        return None

    def _fallback_binding(self, reason: str) -> tuple[ModelBinding, str]:
        if self.fallback_key is not None:
            binding = next(b for b in self.bindings if b.key == self.fallback_key)
            return binding, reason
        return self.bindings[0], reason

    def _resolve_task_metadata(
        self, override: Mapping[str, Any] | None = None
    ) -> Mapping[str, Any]:
        if override is not None:
            return override
        provider = self.task_metadata_provider
        if callable(provider):
            resolved = provider()
            if isinstance(resolved, Mapping):
                return resolved
        return {}

    def route_call_sync(
        self,
        *,
        message_count: int,
        task_metadata: Mapping[str, Any] | None = None,
        call_id: str | None = None,
    ) -> RouteDecision:
        call_id = call_id or uuid4().hex
        routing_metadata = self._build_metadata(
            message_count=message_count,
            task_metadata=task_metadata,
        )
        recommendation = self.client.select_model_sync(
            routing_metadata, request_id=call_id
        )
        return self._decide(
            call_id=call_id,
            recommendation=recommendation,
            routing_metadata=routing_metadata,
        )

    async def route_call_async(
        self,
        *,
        message_count: int,
        task_metadata: Mapping[str, Any] | None = None,
        call_id: str | None = None,
    ) -> RouteDecision:
        call_id = call_id or uuid4().hex
        routing_metadata = self._build_metadata(
            message_count=message_count,
            task_metadata=task_metadata,
        )
        recommendation = await self.client.select_model(
            routing_metadata, request_id=call_id
        )
        return self._decide(
            call_id=call_id,
            recommendation=recommendation,
            routing_metadata=routing_metadata,
        )

    def _build_metadata(
        self,
        *,
        message_count: int,
        task_metadata: Mapping[str, Any] | None,
    ) -> SafeRoutingMetadata:
        resolved_metadata = self._resolve_task_metadata(task_metadata)
        return build_routing_metadata(
            candidate_models=self.candidate_model_ids(),
            task_metadata=resolved_metadata,
            message_count=message_count,
            latency_budget_ms=self.latency_budget_ms,
            budget_usd=self.budget_usd,
            integration_version=self.integration_version,
        )

    def _decide(
        self,
        *,
        call_id: str,
        recommendation: Recommendation,
        routing_metadata: Mapping[str, Any],
    ) -> RouteDecision:
        binding = self._match_binding(recommendation.selected_model)
        if binding is not None:
            decision = RouteDecision(
                call_id=call_id,
                binding=binding,
                recommendation=recommendation,
                fallback_used=False,
                fallback_reason=None,
                routing_metadata=dict(routing_metadata),
            )
            self._store(decision)
            return decision

        recommended = recommendation.selected_model
        reason = "no_recommendation" if recommended is None else "recommendation_not_in_routing_set"

        if self.unavailable_policy == "decline":
            raise ModelUnavailableError(
                recommendation=recommended or "<no recommendation>",
                allowed_models=self.routing_keys(),
            )

        fallback_binding, resolved_reason = self._fallback_binding(reason)
        decision = RouteDecision(
            call_id=call_id,
            binding=fallback_binding,
            recommendation=recommendation,
            fallback_used=True,
            fallback_reason=resolved_reason,
            routing_metadata=dict(routing_metadata),
        )
        self._store(decision)
        return decision

    def _store(self, decision: RouteDecision) -> None:
        with self._lock:
            self._state[decision.call_id] = decision

    def pop_decision(self, call_id: str) -> RouteDecision | None:
        with self._lock:
            return self._state.pop(call_id, None)

    def get_decision(self, call_id: str) -> RouteDecision | None:
        with self._lock:
            return self._state.get(call_id)

    def active_call_ids(self) -> list[str]:
        with self._lock:
            return list(self._state.keys())


HOKUSAI_ROUTER_STATE_KEY = "_hokusai_router_state"


@dataclass
class _RouterState:
    resolver: HokusaiRouteResolver
    last_call_id: str | None = None


def _get_state(instance: Any) -> _RouterState:
    """Read the router state from ``instance.__dict__``, bypassing pydantic
    and OpenHands ``RouterLLM.__getattr__`` (which delegates to
    ``active_llm``)."""

    state = instance.__dict__.get(HOKUSAI_ROUTER_STATE_KEY)
    if not isinstance(state, _RouterState):
        raise ConfigurationError(
            "HokusaiRouterLLM has no resolver bound. Construct it via "
            "create_hokusai_router_llm(...) or call attach_hokusai_resolver()."
        )
    return state


def attach_hokusai_resolver(instance: Any, resolver: HokusaiRouteResolver) -> None:
    """Attach a resolver to a RouterLLM instance without triggering pydantic
    validation or the ``__getattr__`` delegation."""

    instance.__dict__[HOKUSAI_ROUTER_STATE_KEY] = _RouterState(resolver=resolver)


def hokusai_select_llm(
    instance: Any,
    messages: Any,
    *,
    task_metadata: Mapping[str, Any] | None = None,
) -> str:
    """Ask the bound resolver which routing key to use for this call.

    Returns the routing key (a valid key of ``llms_for_routing``) and stashes
    the call id on the instance so downstream code can correlate telemetry.
    """

    state = _get_state(instance)
    try:
        message_count = len(messages) if messages is not None else 0
    except TypeError:
        message_count = 0
    try:
        decision = state.resolver.route_call_sync(
            message_count=message_count,
        )
    except (RoutingCallFailed, PromptLeakageError) as exc:
        LOGGER.warning("Hokusai routing failed: %s", exc)
        raise

    state.last_call_id = decision.call_id
    if task_metadata is not None:
        LOGGER.debug(
            "hokusai_select_llm ignored task_metadata override; "
            "use resolver.task_metadata_provider"
        )

    return decision.routing_key


def last_call_id(instance: Any) -> str | None:
    """Return the ``call_id`` produced by the most recent ``select_llm`` call
    on this instance, or ``None`` if no call has occurred yet."""

    state = instance.__dict__.get(HOKUSAI_ROUTER_STATE_KEY)
    if isinstance(state, _RouterState):
        return state.last_call_id
    return None


def _try_import_router_llm() -> Any:
    try:
        from openhands.sdk.llm.router.base import RouterLLM
    except Exception:  # pragma: no cover - only exercised without openhands-sdk installed
        return None
    return RouterLLM


_ROUTER_LLM_CLS = _try_import_router_llm()


def create_hokusai_router_llm(
    resolver: HokusaiRouteResolver,
    *,
    llms_for_routing: Mapping[str, Any],
    router_name: str = "hokusai_router",
    task_metadata_provider: Any = None,
    **router_kwargs: Any,
) -> Any:
    """Instantiate a Hokusai-backed OpenHands ``RouterLLM``.

    Requires ``openhands-sdk`` to be installed. Attaches ``resolver`` to the
    instance via :func:`attach_hokusai_resolver` so subsequent
    ``select_llm(messages)`` calls consult Hokusai.
    """

    if _ROUTER_LLM_CLS is None:
        raise ConfigurationError(
            "openhands-sdk is not installed. Install with "
            "`pip install 'hokusai-openhands-example[openhands]'` or add "
            "`openhands-sdk` to your environment to use HokusaiRouterLLM."
        )

    if task_metadata_provider is not None:
        resolver.task_metadata_provider = task_metadata_provider

    router_keys = list(llms_for_routing.keys())
    resolver_keys = set(resolver.routing_keys())
    missing = [key for key in resolver_keys if key not in router_keys]
    if missing:
        raise ConfigurationError(
            f"Resolver bindings reference routing keys not in llms_for_routing: {missing}"
        )

    class _HokusaiRouterLLM(_ROUTER_LLM_CLS):  # type: ignore[misc,valid-type]
        def select_llm(self, messages: Any) -> str:
            return hokusai_select_llm(self, messages)

    instance = _HokusaiRouterLLM(
        router_name=router_name,
        llms_for_routing=dict(llms_for_routing),
        **router_kwargs,
    )
    attach_hokusai_resolver(instance, resolver)
    return instance
