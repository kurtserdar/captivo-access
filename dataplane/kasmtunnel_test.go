package main

import "testing"

func TestClampKasmDimFloor(t *testing.T) {
	// Below the new mobile floor clamps up to it; a phone width passes through.
	if got := clampKasmDim(100, 360, 2560, 1280); got != 360 {
		t.Errorf("clampKasmDim(100,360,...) = %d, want 360", got)
	}
	if got := clampKasmDim(400, 360, 2560, 1280); got != 400 {
		t.Errorf("clampKasmDim(400,360,...) = %d, want 400", got)
	}
	if got := clampKasmDim(0, 360, 2560, 1280); got != 1280 {
		t.Errorf("clampKasmDim(0,...) = %d, want default 1280", got)
	}
	if got := clampKasmDim(480, 480, 1600, 800); got != 480 {
		t.Errorf("clampKasmDim(480,480,...) = %d, want 480", got)
	}
}
