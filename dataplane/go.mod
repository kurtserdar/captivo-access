module github.com/kurtserdar/captivo-access/dataplane

go 1.23.4

require (
	github.com/coder/websocket v1.8.15
	github.com/hashicorp/yamux v0.1.2
	github.com/kurtserdar/captivo-access/tunnel v0.0.0
)

replace github.com/kurtserdar/captivo-access/tunnel => ../tunnel
