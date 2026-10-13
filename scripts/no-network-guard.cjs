// Preload (node --require) that makes every network entry point throw, so a
// child process provably cannot reach the network. Used by
// scripts/smoke-costs-consumer.mjs to verify the @hokusai/costs offline
// example end to end.
'use strict';

function forbid(what) {
  return function networkForbidden() {
    throw new Error(`NETWORK_FORBIDDEN: ${what} attempted`);
  };
}

globalThis.fetch = forbid('fetch');

const http = require('node:http');
const https = require('node:https');
http.request = forbid('http.request');
http.get = forbid('http.get');
https.request = forbid('https.request');
https.get = forbid('https.get');

const net = require('node:net');
net.connect = forbid('net.connect');
net.createConnection = forbid('net.createConnection');
net.Socket.prototype.connect = forbid('net.Socket#connect');

const dns = require('node:dns');
dns.lookup = forbid('dns.lookup');
dns.resolve = forbid('dns.resolve');
if (dns.promises) {
  dns.promises.lookup = forbid('dns.promises.lookup');
  dns.promises.resolve = forbid('dns.promises.resolve');
}
