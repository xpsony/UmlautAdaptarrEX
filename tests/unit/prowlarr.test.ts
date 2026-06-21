import {describe, expect, it} from "vitest";
import {parseProwlarrApplications} from "@/arr/prowlarr";
import {isMaskedSecret} from "@/lib/secrets";

describe("isMaskedSecret", () => {
    it("recognizes the bullet/middot sentinel and Prowlarr asterisk masks, leaves real keys alone", () => {
        expect(isMaskedSecret("••••••••")).toBe(true);
        expect(isMaskedSecret("••••")).toBe(true);
        expect(isMaskedSecret("········")).toBe(true);
        // Prowlarr masks API keys with asterisks — must be detected.
        expect(isMaskedSecret("********")).toBe(true);
        expect(isMaskedSecret("****")).toBe(true);
        expect(isMaskedSecret("")).toBe(false);
        expect(isMaskedSecret("abcdef1234567890")).toBe(false);
        expect(isMaskedSecret("***real***")).toBe(false);
        // The literal dot is excluded, so a legitimate dot-containing secret is
        // not silently dropped on a settings round-trip.
        expect(isMaskedSecret("........")).toBe(false);
    });
});

describe("parseProwlarrApplications", () => {
    it("maps Sonarr/Radarr/Lidarr/Readarr to ArrType, skips Whisparr", () => {
        const raw = [
            {
                id: 1,
                name: "Sonarr",
                implementation: "Sonarr",
                syncLevel: "fullSync",
                fields: [
                    {name: "baseUrl", value: "http://sonarr:8989"},
                    {name: "apiKey", value: "abcdef1234567890"},
                ],
            },
            {
                id: 2,
                name: "Radarr 4K",
                implementation: "Radarr",
                syncLevel: "addOnly",
                fields: [
                    {name: "baseUrl", value: "http://radarr:7878/"},
                    {name: "apiKey", value: "deadbeefdeadbeef"},
                ],
            },
            {
                id: 3,
                name: "Whisparr instance",
                implementation: "Whisparr",
                fields: [
                    {name: "baseUrl", value: "http://whisparr:6969"},
                    {name: "apiKey", value: "irrelevant1234567"},
                ],
            },
        ];

        const result = parseProwlarrApplications(raw);

        expect(result.apps).toHaveLength(2);
        expect(result.apps[0]).toMatchObject({
            prowlarrId: 1,
            type: "sonarr",
            name: "Sonarr",
            host: "http://sonarr:8989",
            apiKey: "abcdef1234567890",
        });
        expect(result.apps[1]).toMatchObject({
            type: "radarr",
            host: "http://radarr:7878",
        });
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toMatchObject({
            prowlarrId: 3,
            reason: "unsupported_type",
            implementation: "Whisparr",
        });
    });

    it("keeps apps whose api key is missing in the list with empty apiKey", () => {
        const raw = [
            {
                id: 9,
                name: "Sonarr",
                implementation: "Sonarr",
                fields: [
                    {name: "baseUrl", value: "http://sonarr:8989"},
                    {name: "apiKey", value: ""},
                ],
            },
            {
                id: 10,
                name: "Lidarr",
                implementation: "Lidarr",
                fields: [
                    {name: "baseUrl", value: "http://lidarr:8686"},
                    {name: "apiKey", value: null},
                ],
            },
        ];

        const result = parseProwlarrApplications(raw);

        expect(result.apps).toHaveLength(2);
        expect(result.apps.every((a) => a.apiKey === "")).toBe(true);
        expect(result.skipped).toHaveLength(0);
    });

    it("skips apps without baseUrl", () => {
        const raw = [
            {
                id: 11,
                name: "Readarr",
                implementation: "Readarr",
                fields: [{name: "apiKey", value: "abcdef1234567890"}],
            },
        ];

        const result = parseProwlarrApplications(raw);
        expect(result.apps).toHaveLength(0);
        expect(result.skipped[0]?.reason).toBe("missing_host");
    });

    it("skips apps whose baseUrl has no http(s):// scheme", () => {
        const raw = [
            {
                id: 13,
                name: "Sonarr (broken)",
                implementation: "Sonarr",
                fields: [
                    {name: "baseUrl", value: "sonarr:8989"},
                    {name: "apiKey", value: "abcdef1234567890"},
                ],
            },
            {
                id: 14,
                name: "Radarr (ftp)",
                implementation: "Radarr",
                fields: [
                    {name: "baseUrl", value: "ftp://radarr:7878"},
                    {name: "apiKey", value: "abcdef1234567890"},
                ],
            },
        ];
        const result = parseProwlarrApplications(raw);
        expect(result.apps).toHaveLength(0);
        expect(result.skipped).toHaveLength(2);
        expect(result.skipped.every((s) => s.reason === "missing_host")).toBe(true);
    });

    it("keeps apps whose apiKey is just a Prowlarr mask, with apiKey cleared", () => {
        const raw = [
            {
                id: 15,
                name: "Sonarr",
                implementation: "Sonarr",
                fields: [
                    {name: "baseUrl", value: "http://sonarr:8989"},
                    {name: "apiKey", value: "********"},
                ],
            },
            {
                id: 16,
                name: "Radarr",
                implementation: "Radarr",
                fields: [
                    {name: "baseUrl", value: "http://radarr:7878"},
                    {name: "apiKey", value: "••••••••••"},
                ],
            },
        ];
        const result = parseProwlarrApplications(raw);
        expect(result.apps).toHaveLength(2);
        expect(result.apps.every((a) => a.apiKey === "")).toBe(true);
        expect(result.skipped).toHaveLength(0);
    });

    it("truncates names longer than 64 chars", () => {
        const raw = [
            {
                id: 12,
                name: "x".repeat(120),
                implementation: "Sonarr",
                fields: [
                    {name: "baseUrl", value: "http://sonarr:8989"},
                    {name: "apiKey", value: "abcdef1234567890"},
                ],
            },
        ];
        const result = parseProwlarrApplications(raw);
        expect(result.apps[0]?.name.length).toBe(64);
    });
});
