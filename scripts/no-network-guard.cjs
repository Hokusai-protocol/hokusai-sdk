// Preload (node --require) that makes every network primitive throw, so the
// smoke test proves the shipped examples run with the network hard-blocked.
'use strict';

function forbid(name) {
  return function networkForbidden() {
    throw new Error(`NETWORK_FORBIDDEN: ${name} was called`);
  };
}

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dns = require('node:dns');

http.request = forbid('http.request');
http.get = forbid('http.get');
https.request = forbid('https.request');
https.get = forbid('https.get');
net.connect = forbid('net.connect');
net.createConnection = forbid('net.createConnection');
net.Socket.prototype.connect = forbid('net.Socket#connect');
dns.lookup = forbid('dns.lookup');
if (dns.promises) dns.promises.lookup = forbid('dns.promises.lookup');
globalThis.fetch = forbid('fetch');
