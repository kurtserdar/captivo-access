package tunnel

// ControlHello is the data-plane's opening frame on a control stream (Kind
// "control"). The connector dispatches on it and then reports telemetry.
type ControlHello struct {
	Kind string `json:"kind"` // "control"
}

// Telemetry is a periodic connector -> data-plane report on the control stream.
type Telemetry struct {
	Version           string `json:"version"`
	UptimeSec         int64  `json:"uptimeSec"`
	ActiveConnections int    `json:"activeConnections"` // in-flight relay streams (excludes control)
	TotalConnections  int64  `json:"totalConnections"`  // since process start
	DeniedCount       int64  `json:"deniedCount"`       // egress-boundary rejections since start
	BytesIn           int64  `json:"bytesIn"`           // upstream -> vendor bytes relayed since start
	BytesOut          int64  `json:"bytesOut"`          // vendor -> upstream bytes relayed since start
}
