import { describe, expect, it } from "vitest";
import { isPrivateHost } from "@/server/security/ssrf.js";

describe("isPrivateHost - strict private hosts", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.42",
    "10.0.0.1",
    "10.255.255.255",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGN-NAT
    "0.0.0.0",
  ])("blocks dotted-quad %s", (ip) => {
    expect(isPrivateHost(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "192.169.1.1"])(
    "allows public dotted-quad %s",
    (ip) => {
      expect(isPrivateHost(ip)).toBe(false);
    },
  );

  it("strips host:port", () => {
    expect(isPrivateHost("127.0.0.1:8080")).toBe(true);
    expect(isPrivateHost("8.8.8.8:443")).toBe(false);
  });
});

describe("isPrivateHost - IPv4 numeric/short-form bypass plugs", () => {
  it("blocks decimal-32 IPv4 (`2130706433` = 127.0.0.1)", () => {
    expect(isPrivateHost("2130706433")).toBe(true);
  });

  it("blocks octal-prefixed octets (`0177.0.0.1`)", () => {
    expect(isPrivateHost("0177.0.0.1")).toBe(true);
  });

  it("blocks hex-encoded octets (`0x7f.0.0.1`)", () => {
    expect(isPrivateHost("0x7f.0.0.1")).toBe(true);
  });

  it("blocks short-form (`127.1`, `127.0.1`)", () => {
    expect(isPrivateHost("127.1")).toBe(true);
    expect(isPrivateHost("127.0.1")).toBe(true);
  });

  it("does not over-block 4-part decimal (handled by strict parser)", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("203.0.113.1")).toBe(false);
  });
});

describe("isPrivateHost - hostnames", () => {
  it.each([
    "localhost",
    "Localhost",
    "localhost.",
    "ip6-localhost",
    "metadata",
    "metadata.google.internal",
    "host.docker.internal",
  ])("blocks hostname %s", (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });

  it.each(["example.com", "indexer.tracker.io", "umlautadaptarr.pcjones.de"])(
    "allows public hostname %s",
    (h) => {
      expect(isPrivateHost(h)).toBe(false);
    },
  );

  it("blocks private suffixes (.local, .internal, .lan, …)", () => {
    expect(isPrivateHost("foo.local")).toBe(true);
    expect(isPrivateHost("printer.lan")).toBe(true);
    expect(isPrivateHost("svc.cluster.local")).toBe(true);
    expect(isPrivateHost("admin.intranet")).toBe(true);
    expect(isPrivateHost("nas.home")).toBe(true);
  });
});

describe("isPrivateHost - IPv6", () => {
  it.each([
    "::1",
    "[::1]",
    "[::1]:8080",
    "0:0:0:0:0:0:0:1", // expanded loopback
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "::ffff:127.0.0.1", // v4-mapped private
  ])("blocks IPv6 %s", (h) => {
    expect(isPrivateHost(h)).toBe(true);
  });

  it.each(["2001:4860:4860::8888", "2606:4700:4700::1111"])(
    "allows public IPv6 %s",
    (h) => {
      expect(isPrivateHost(h)).toBe(false);
    },
  );
});

describe("isPrivateHost - edge cases", () => {
  it("returns false for empty input", () => {
    expect(isPrivateHost("")).toBe(false);
    expect(isPrivateHost("   ")).toBe(false);
  });

  it("strips trailing dots", () => {
    expect(isPrivateHost("localhost.")).toBe(true);
    expect(isPrivateHost("localhost..")).toBe(true);
  });
});
