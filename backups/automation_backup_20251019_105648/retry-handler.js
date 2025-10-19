class RetryHandler {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.backoffFactor = options.backoffFactor || 2;
    this.retryableErrors = options.retryableErrors || [
      "timeout",
      "network",
      "connection",
      "temporary",
      "rate limit",
      "server error",
      "element not found",
      "page load",
    ];
  }

  async executeWithRetry(operation, context = {}) {
    let lastError = null;
    let attempt = 0;

    while (attempt < this.maxAttempts) {
      attempt++;

      try {
        console.log(
          `Attempt ${attempt}/${this.maxAttempts}${
            context.description ? ` - ${context.description}` : ""
          }`,
        );

        const result = await operation(attempt);

        if (attempt > 1) {
          console.log(`Operation succeeded on attempt ${attempt}`);
        }

        return result;
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);

        // Check if error is retryable
        if (!this.isRetryableError(error) || attempt >= this.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt);
        console.log(`Retrying in ${delay}ms...`);

        await this.sleep(delay);
      }
    }

    // All attempts failed
    throw new Error(
      `Operation failed after ${this.maxAttempts} attempts. Last error: ${lastError.message}`,
    );
  }

  isRetryableError(error) {
    const errorMessage = error.message.toLowerCase();

    return this.retryableErrors.some((retryableError) =>
      errorMessage.includes(retryableError.toLowerCase()),
    );
  }

  calculateDelay(attempt) {
    const delay = this.baseDelay * Math.pow(this.backoffFactor, attempt - 1);
    return Math.min(delay, this.maxDelay);
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = RetryHandler;
