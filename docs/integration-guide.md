# Integration Guide

This repository is intentionally split between reusable contracts and harness adapters.

## Recommended integration flow

1. Depend on `@hokusai/core` for shared task, outcome, consent, anonymization, and correlation abstractions.
2. Choose an adapter package when a harness needs opinionated command or manifest metadata.
3. Use `examples/reference-harness` as the smallest offline composition template.

## Current scope

- Adapters expose typed factories and metadata only.
- Live harness APIs, authentication, transport, and protocol negotiation are future work.
- Private Wavemill code is out of scope for this repository.
