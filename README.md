# AisStream WebSocket to MQTT Bridge

This Node.js application connects to an AIS WebSocket stream, transforms AIS messages into a standardized JSON format, and forwards them to an MQTT broker to be consumed by Catalog Explorer Live Tracks. It supports automatic WebSocket reconnection and configurable options via a `.env` file or CLI arguments.

---

## Features

- Connects to AIS WebSocket streams in real-time.
- Automatically transforms messages into the format:

```json
{
  "action": "PUT",
  "geometry": {
    "type": "Point",
    "coordinates": [longitude, latitude]
  },
  "id": SHIP_MMSI,
  "properties": {
    "ShipName": "name",
    "...": "other AIS properties"
  }
}
```

- Publishes messages to MQTT brokers.
- Supports optional block ID for grouping messages in MQTT topics.
- Automatic WebSocket reconnection on disconnect.
- Configurable via `.env` file or CLI arguments (MQTT broker, topic, WebSocket URL, API key, username, password, bounding box, block ID).
- Optional logging of `PositionReport` messages.

---

## Requirements

- Node.js >= 18
- NPM >= 9
- An MQTT broker (e.g., Mosquitto)
- Access to an AIS WebSocket stream

---

## Installation

Clone the repository:

```bash
git clone https://github.com/felipecarrillo100/aisstream-ws-mqtt.git
cd aisstream-ws-mqtt
npm install
```

## .enc file
Create a `.env` file in the project root with your configuration, you can copy .env.sample to .env and change the values accordingly


---

## Usage

Run the app using `.env` configuration:

```bash
node index.js
```

Or override settings with CLI arguments:

```text
--bbox       Bounding box in JSON format [[lat1, lon1],[lat2, lon2]] (optional)
--blockid    Block ID to include in MQTT topics (optional)
-h, --help   Show this help message
```

Example with custom bounding box and block ID:

```bash
node index.js --bbox "[[51,-6],[66,20]]" --blockid 123
```

With BLOCK_ID, messages are published as:

```
producers/aisstream/data/<BLOCK_ID>/PositionReport/<MMSI>
```

Without BLOCK_ID, messages are published as:

```
producers/aisstream/data/PositionReport/<MMSI>
```

---

## Project Structure

```
.
├── index.js                   # Main application script
├── modules/
│   └── MessageProducerMQTT.js # MQTT producer module
├── package.json
├── .env                       # Environment configuration (not committed)
└── README.md
```

---

## Graceful Shutdown

Press `CTRL+C` to stop the application safely. The MQTT client disconnects automatically.

---

## Use in Catalog Explorer

Subscribe to `/topic/producers.aisstream` or `/topic/producers/aisstream` depending on your separator character.  
Use wildcard `>` to receive both live position updates and ship static data updates.
Use wildcard `PositionReport.>` to receive only live position updates.
---

## License

MIT License. See [LICENSE]