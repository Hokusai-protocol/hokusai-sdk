class HokusaiOpenHandsError(RuntimeError):
    """Base error for the OpenHands adapter."""


class PromptLeakageError(ValueError):
    """Raised when outbound payloads include forbidden prompt-like fields."""


class RoutingUnavailableError(HokusaiOpenHandsError):
    """Raised when the Hokusai routing request fails or returns malformed data."""


class ModelUnavailableError(HokusaiOpenHandsError):
    """Raised when Hokusai recommends a model outside the runnable OpenHands set."""


class ContributionSubmissionFailed(HokusaiOpenHandsError):
    """Raised when contribution submission fails."""
