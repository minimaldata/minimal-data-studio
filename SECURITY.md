# Security

## Intended use

This project runs locally for one trusted user. SQL, Python/R kernels, runtime probes, and the interactive shell run with that user's permissions. The terminal uses per-browser database session IDs; its routes require local Host/Origin checks. Custom runtime selection launches the selected executable to verify it. Notebook, dashboard, and saved-query opening can execute code. The Files pane's project boundary is a navigation rule, not isolation for executed code.

The HTTP service binds to loopback. Its database and kernel routes check the local Host, and mutations check the editor Origin. These checks are not a substitute for authentication or isolation in a hosted deployment. Do not expose the service to a network or use it as a multi-user classroom server.

Dependencies include frontend assets loaded from public CDNs. Offline assets, desktop packaging, sandboxing, and managed multi-user hosting are not currently provided.

## Reporting a vulnerability

Do not post credentials, private data, or exploitable security details in a public issue. Use GitHub's **Security → Report a vulnerability** option on this repository when available. If it is unavailable, open a minimal issue asking the maintainer for a private reporting channel, without the technical details. There is no guaranteed response time or supported-release policy yet.
