package tunnel

// Policy is a data-plane -> connector frame on the control stream. Extensible:
// later slices add fields; the connector applies what it understands and ignores
// the rest. Every frame the connector reads on the control stream is a Policy
// (direction determines type), so no discriminator is needed.
type Policy struct {
	EgressAllowedTargets string `json:"egressAllowedTargets"` // "" = no console narrowing
}
