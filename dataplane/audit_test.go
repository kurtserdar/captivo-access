package main

import "testing"

func TestAuditQueueDropsOldestWhenFull(t *testing.T) {
	q := NewAuditQueue(2)
	q.Enqueue(AuditEvent{Path: "/a"})
	q.Enqueue(AuditEvent{Path: "/b"})
	q.Enqueue(AuditEvent{Path: "/c"}) // full → drop "/a"
	got := q.drain(10)
	if len(got) != 2 || got[0].Path != "/b" || got[1].Path != "/c" {
		t.Fatalf("got %+v", got)
	}
	if q.Dropped() != 1 {
		t.Fatalf("dropped=%d want 1", q.Dropped())
	}
}

func TestAuditQueueDrainMax(t *testing.T) {
	q := NewAuditQueue(10)
	for i := 0; i < 5; i++ {
		q.Enqueue(AuditEvent{})
	}
	if len(q.drain(3)) != 3 {
		t.Fatal("want 3")
	}
	if len(q.drain(10)) != 2 {
		t.Fatal("want 2")
	}
}
