const mqtt = require('mqtt');

class MessageProducerMQTT {
  /**
   * @param {object} options
   * @param {string} options.brokerUrl - full mqtt URL, e.g. mqtt://localhost:1883
   * @param {string} [options.username]
   * @param {string} [options.password]
   */
  constructor(options) {
    this.brokerUrl = options.brokerUrl;
    this.username = options.username;
    this.password = options.password;

    this.client = null;
    this.connected = false;
  }

  init() {
    return new Promise((resolve, reject) => {
      const connectOpts = {};
      if (this.username && this.password) {
        connectOpts.username = this.username;
        connectOpts.password = this.password;
      }

      this.client = mqtt.connect(this.brokerUrl, connectOpts);

      this.client.on('connect', () => {
        this.connected = true;
        console.log(`MQTT connected to ${this.brokerUrl}`);
        resolve(this);
      });

      this.client.on('error', (err) => {
        console.error('MQTT connection error:', err.message);
        reject(err);
      });
    });
  }

  sendMessage(topic, message) {
    if (!this.connected) {
      console.warn('MQTT client not connected, cannot send message');
      return;
    }

    const payload = (typeof message === 'string') ? message : JSON.stringify(message);
    this.client.publish(topic, payload);
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.connected = false;
      console.log('MQTT client disconnected');
    }
  }

  createPath(path) {
    return path;
  }
}

module.exports = MessageProducerMQTT;