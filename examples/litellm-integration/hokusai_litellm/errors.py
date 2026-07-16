class PromptLeakageError(ValueError):
    """Raised when an outbound payload attempts to include forbidden fields."""


class ConfigurationError(ValueError):
    """Raised when the integration is misconfigured."""


class RoutingCallFailed(RuntimeError):
    """Raised when the Hokusai routing API call fails or returns malformed data."""


class ContributionSubmissionFailed(RuntimeError):
    """Raised when the Hokusai contribution API call fails."""
