class PromptLeakageError(ValueError):
    """Raised when an outbound payload attempts to include forbidden fields."""


class ConfigurationError(ValueError):
    """Raised when the integration is misconfigured."""


class RoutingCallFailed(RuntimeError):
    """Raised when the Hokusai routing API call fails or returns malformed data."""


class ContributionSubmissionFailed(RuntimeError):
    """Raised when the Hokusai contribution API call fails."""


class MissingRouteIdError(RoutingCallFailed):
    """Raised when a Hokusai routing response lacks the required route id.

    Outcome rows must set ``inference_log_id``, so a routed call that cannot
    identify the route is unusable and should surface loudly.
    """


class ModelUnavailableError(ConfigurationError):
    """Raised when Hokusai recommends a model not present in the configured OpenHands set."""

    def __init__(self, recommendation: str, allowed_models: list[str]) -> None:
        self.recommendation = recommendation
        self.allowed_models = list(allowed_models)
        super().__init__(
            f"Hokusai recommended model {recommendation!r} which is not in the "
            f"configured OpenHands routing set {self.allowed_models}"
        )
