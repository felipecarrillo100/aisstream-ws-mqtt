#!/usr/bin/env node
'use strict';

require('dotenv').config();
const WebSocket = require('ws');
const minimist = require('minimist');
const MessageProducerMQTT = require('./modules/MessageProducerMQTT');


const DEBUG_LOG= process.env.DEBUG_LOG || false ;
// Defaults from environment
const DEFAULT_MQTT_HOST = process.env.MQTT_HOST || "localhost" ;
const DEFAULT_MQTT_PORT = process.env.MQTT_PORT || 1883;

const DEFAULT_MQTT_BROKER = `mqtt://${DEFAULT_MQTT_HOST}:${DEFAULT_MQTT_PORT}`;
const DEFAULT_MQTT_BROKER_USERNAME = process.env.MQTT_USER || 'admin';
const DEFAULT_MQTT_BROKER_PASSWORD = process.env.MQTT_PASS || 'admin';
const DEFAULT_TOPIC = process.env.MQTT_TOPIC;
const DEFAULT_API_KEY = process.env.AIS_API_KEY;
const DEFAULT_WS = process.env.WS_URL;
const RECONNECT_INTERVAL = 5000; // ms

// Default bounding box: North Sea + Baltic Sea
const DEFAULT_BBOX = [
  [
    [51.0, -6.0],   // Southwest corner: Latitude 51°N, Longitude -6°E
    [66.0, 20.0]    // Northeast corner: Latitude 66°N, Longitude 20°E
  ]
];

function printHelp() {
  console.log(`
Usage: node aisWsToMqtt.js [options]

Options:
  --bbox       Bounding box in JSON format [[lat1, lon1],[lat2, lon2]] (optional)
  --blockid    Block ID to include in messages (optional)
  -h, --help   Show this help message
`);
}

// Parse CLI args for bbox and blockid
const args = minimist(process.argv.slice(2), {
  string: ['bbox', 'blockid'],
  boolean: ['help'],
  alias: { h: 'help' }
});

if (args.help) {
  printHelp();
  process.exit(0);
}

let DEFAULT_BBOX_CLI = DEFAULT_BBOX;
if (args.bbox) {
  try {
    const parsedBbox = JSON.parse(args.bbox);
    if (Array.isArray(parsedBbox)) {
      DEFAULT_BBOX_CLI = parsedBbox;
    } else {
      console.warn('Invalid bbox format, using default');
    }
  } catch (e) {
    console.warn('Failed to parse bbox argument, using default');
  }
}

const BLOCK_ID = args.blockid || null;

// Initialize MQTT producer
const producer = new MessageProducerMQTT({
  brokerUrl: DEFAULT_MQTT_BROKER,
  username: DEFAULT_MQTT_BROKER_USERNAME,
  password: DEFAULT_MQTT_BROKER_PASSWORD,
});

const topicControl = replaceDataWithControl(DEFAULT_TOPIC);

producer.init().then(() => {
  console.log(`MQTT producer ready, publishing to topic: ${DEFAULT_TOPIC}`);
  producer.sendMessage(topicControl, JSON.stringify({ action: "CLEAR" }));
  const websocket = connectWebSocket();
  setupGracefulShutdown(websocket, producer);
}).catch((err) => {
  console.error('Failed to initialize MQTT producer:', err);
  process.exit(1);
});

// Transform AIS message to desired format
function transformMessageAndSort(aisMessage) {
  if (!aisMessage || !aisMessage.Message) return null;
  const { MessageType, Message, MetaData } = aisMessage;
  if (!MetaData) return null;

  let geometry;
  let id = MetaData.MMSI || null;
  let properties = {};

  const extractProps = (key) => {
    if (!Message[key]) return;
    if (key === 'ShipStaticData') {
      properties = { ...Message[key] };
      properties.ShipStaticData = { ...Message[key] };
      delete properties.MessageID;
      delete properties.RepeatIndicator;
      delete properties.Spare;
      delete properties.UserID;
      delete properties.Valid;
    } else {
      properties = { [key]: { ...Message[key] } };
    }
  };

  switch (MessageType) {
    case 'PositionReport':
      if (Message.PositionReport) {
        const pos = Message.PositionReport;
        geometry = { type: 'Point', coordinates: [pos.Longitude, pos.Latitude] };
        properties = { ShipName: MetaData.ShipName || '', ...pos };
      }
      break;
    case 'ShipStaticData': extractProps('ShipStaticData'); break;
    case 'StandardClassBPositionReport': extractProps('StandardClassBPositionReport'); break;
    case 'ExtendedClassBPositionReport': extractProps('ExtendedClassBPositionReport'); break;
    case 'DataLinkManagementMessage': extractProps('DataLinkManagementMessage'); break;
    case 'UnknownMessage': properties = {}; break;
    case 'StaticDataReport': extractProps('StaticDataReport'); break;
    case 'AidsToNavigationReport': extractProps('AidsToNavigationReport'); break;
    case 'Interrogation': extractProps('Interrogation'); break;
    case 'BaseStationReport': extractProps('BaseStationReport'); break;
    case 'StandardSearchAndRescueAircraftReport': extractProps('StandardSearchAndRescueAircraftReport'); break;
    case 'AddressedBinaryMessage': extractProps('AddressedBinaryMessage'); break;
    case 'GnssBroadcastBinaryMessage': extractProps('GnssBroadcastBinaryMessage'); break;
    case 'ChannelManagement': extractProps('ChannelManagement'); break;
    case 'BinaryAcknowledge': extractProps('BinaryAcknowledge'); break;
    case 'AssignedModeCommand': extractProps('AssignedModeCommand'); break;
    case 'SingleSlotBinaryMessage': extractProps('SingleSlotBinaryMessage'); break;
    case 'MultiSlotBinaryMessage': extractProps('MultiSlotBinaryMessage'); break;
    case 'AddressedSafetyMessage': extractProps('AddressedSafetyMessage'); break;
    case 'SafetyBroadcastMessage': extractProps('SafetyBroadcastMessage'); break;
    case 'CoordinatedUTCInquiry': extractProps('CoordinatedUTCInquiry'); break;
    default: properties = {};
  }


  const message = {
    action: MessageType === 'PositionReport' ? 'PUT' : 'PATCH',
    id,
    geometry,
    properties
  };

  return { type: MessageType, message };
}

// WebSocket connection with auto-reconnect
function connectWebSocket() {
  const socket = new WebSocket(DEFAULT_WS);

  socket.on('open', () => {
    console.log(`Connected to WebSocket ${DEFAULT_WS}`);
    const subscriptionMessage = { APIkey: DEFAULT_API_KEY, BoundingBoxes: DEFAULT_BBOX_CLI };
    const maskedApiKey = maskApiKey(DEFAULT_API_KEY);
    console.log('Sending subscription:', JSON.stringify({ ...subscriptionMessage, APIkey: maskedApiKey }));
    socket.send(JSON.stringify(subscriptionMessage));
  });

  socket.on('message', (data) => {
    try {
      const aisMessage = JSON.parse(data.toString());
      const { type, message } = transformMessageAndSort(aisMessage);

      if (type && message) {
        if (type === 'PositionReport') {
          if (BLOCK_ID) {
            producer.sendMessage(`${DEFAULT_TOPIC}/${BLOCK_ID}/${type}/${message.id}`, message);
          } else {
            producer.sendMessage(`${DEFAULT_TOPIC}/${type}/${message.id}`, message);
          }
          const props = message.properties;
          if (DEBUG_LOG) console.log(`${type} | MMSI: ${props.UserID} id ${message.id} name ${props.ShipName}`);
        } else if (type === 'ShipStaticData') {
          if (BLOCK_ID) {
            producer.sendMessage(`${DEFAULT_TOPIC}/${BLOCK_ID}/${type}/${message.id}`, message);
          } else {
            producer.sendMessage(`${DEFAULT_TOPIC}/${type}/${message.id}`, message);
          }
          if (DEBUG_LOG)console.log(`${type} | MMSI: ${message.id} id ${message.id} name ${message.properties.ShipStaticData?.ShipName || ''}`);
        }
      }

    } catch (err) {
      console.error('Failed to parse WebSocket message:', err, 'Data:', data.toString());
    }
  });

  socket.on('error', (err) => console.error('WebSocket error:', err));

  socket.on('close', () => {
    console.log(`WebSocket connection closed. Reconnecting in ${RECONNECT_INTERVAL / 1000}s...`);
    setTimeout(connectWebSocket, RECONNECT_INTERVAL);
  });

  return socket;
}

// Graceful shutdown
// process.on('SIGINT', async () => {
//   console.log('Shutting down...');
//   await producer.disconnect();
//   process.exit(0);
// });

function replaceDataWithControl(path) {
  const parts = path.split('/');
  if (parts.length >= 3 && parts[0] === 'producers' && parts[2] === 'data') {
    parts[2] = 'control';
    return parts.join('/');
  }
  return path;
}

function setupGracefulShutdown(websocket, broker) {
    const shutdown = async (signal) => {
        console.log(`\nReceived ${signal}, shutting down gracefully...`);

        try {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                console.log("Closing WebSocket...");
                websocket.close();
                console.log("WebSocket closed");
            }
            if (broker && typeof broker.disconnect === "function") {
                await broker.disconnect(); // ✅ Clean broker close if supported
            }
        } catch (err) {
            console.error("Error during shutdown:", err);
        } finally {
            console.log("Shutdown complete. Exiting.");
            process.exit(0);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));  // Ctrl + C locally
    process.on("SIGTERM", () => shutdown("SIGTERM")); // Docker stop
}

function maskApiKey(apiKey) {
    if (!apiKey || apiKey.length <= 4) return apiKey;
    const visible = apiKey.slice(-4);
    const masked = '*'.repeat(apiKey.length - 4);
    return masked + visible;
}
