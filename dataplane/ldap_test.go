package main

import (
	"testing"

	"github.com/go-ldap/ldap/v3"
)

func TestEntryToResolve(t *testing.T) {
	e := &ldap.Entry{
		DN: "CN=Jane,OU=Users,DC=corp,DC=local",
		Attributes: []*ldap.EntryAttribute{
			{Name: "memberOf", Values: []string{"CN=Admins,OU=Groups,DC=corp,DC=local", "CN=DB-Ops,OU=Groups,DC=corp,DC=local"}},
			{Name: "displayName", Values: []string{"Jane Doe"}},
		},
	}
	got := entryToResolve(e)
	if !got.Found {
		t.Fatalf("expected Found=true")
	}
	if got.DN != "CN=Jane,OU=Users,DC=corp,DC=local" {
		t.Fatalf("DN mismatch: %q", got.DN)
	}
	if len(got.MemberOf) != 2 || got.MemberOf[0] != "CN=Admins,OU=Groups,DC=corp,DC=local" {
		t.Fatalf("MemberOf mismatch: %v", got.MemberOf)
	}
	if got.DisplayName != "Jane Doe" {
		t.Fatalf("DisplayName mismatch: %q", got.DisplayName)
	}
}
