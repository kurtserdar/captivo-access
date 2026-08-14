package main

// fileTransferAllows maps a site's fileTransferMode to per-direction booleans.
// up = vendor -> isolated (upload); down = isolated -> vendor (download).
// Unknown/empty defaults to denied both ways (isolation-first).
func fileTransferAllows(mode string) (up, down bool) {
	switch mode {
	case "allow":
		return true, true
	case "no_upload":
		return false, true
	case "no_download":
		return true, false
	default: // "none", "", unknown
		return false, false
	}
}
