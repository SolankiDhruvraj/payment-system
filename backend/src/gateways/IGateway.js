// ─── IGateway Interface ───────────────────────────────────────────────────────
// Defines the contract all payment gateways must implement.
// Enables the Adapter Pattern 

export class IGateway {
  async createOrder(params) {
    throw new Error('IGateway.createOrder() must be implemented');
  }
  async verifySignature(params) {
    throw new Error('IGateway.verifySignature() must be implemented');
  }

  async capturePayment(paymentId, amount) {
    throw new Error('IGateway.capturePayment() must be implemented');
  }

  async getPayment(paymentId) {
    throw new Error('IGateway.getPayment() must be implemented');
  }

  async refundPayment(paymentId, amount) {
    throw new Error('IGateway.refundPayment() must be implemented');
  }

  verifyWebhookSignature(rawBody, signature) {
    throw new Error('IGateway.verifyWebhookSignature() must be implemented');
  }
  getName() {
    throw new Error('IGateway.getName() must be implemented');
  }
}
