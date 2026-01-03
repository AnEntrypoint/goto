# Ice Climber .io - Game Server

Production-grade multiplayer game server with real-time physics, networking, and observability.

## Quick Start

### Development

```bash
npm install
NODE_ENV=development PORT=3008 node server/index.js
```

Health check: `curl http://localhost:3008/health`

### Docker

```bash
docker build -t game-server:latest .
docker run -p 3008:3008 -e NODE_ENV=production game-server:latest
```

### Kubernetes

```bash
kubectl apply -f k8s/
```

## Configuration

### Environment Variables

```bash
PORT=3008                              # Server port (1000-65535)
NODE_ENV=development|production        # Environment mode
LOG_LEVEL=debug|info|warn|error        # Logging level
API_KEY=<secret>                       # API authentication
DATABASE_URL=<connection-string>       # Player data persistence
```

### Config Files

- `config.development.json` - Development settings
- `config.production.json` - Production settings
- `.env.example` - Example environment variables

## Endpoints

- `GET /health` - Liveness probe
- `GET /ready` - Readiness probe
- `GET /metrics` - Prometheus metrics
- `ws://localhost:3008` - Game connection

## Deployment

See `DEPLOYMENT.md` for detailed instructions on Docker and Kubernetes deployment.

## Monitoring

See `SLI.md` for service level indicators and `alert-rules.yml` for Prometheus alerts.

## Incident Response

See `INCIDENT_RESPONSE.md` for production troubleshooting guide.

## License

Proprietary - Ice Climber .io
