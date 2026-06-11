import * as fs   from "fs";
import * as path from "path";

export interface CpcLaunch {
    type:        string;   // "disk"|"snapshot"|"tape"|"cartridge"|"plain"
    disk?:       string;
    diskB?:      string;
    tape?:       string;
    snapshot?:   string;
    cartridge?:  string;
    symbolFile?: string;
    port?:       number;
}

export interface CpcProjectConfig {
    configuration?: string;   // --cfg argument for Sugarbox (e.g. "CPC6128FR")
    launch?:        CpcLaunch;
}

export class CpcConfig {
    static readonly filename = "cpc.json";

    static read(workspaceRoot: string): CpcProjectConfig | null {
        const filePath = path.join(workspaceRoot, CpcConfig.filename);
        if (!fs.existsSync(filePath)) return null;
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            return JSON.parse(raw) as CpcProjectConfig;
        } catch {
            return null;
        }
    }

    static write(workspaceRoot: string, cfg: CpcProjectConfig): void {
        const filePath = path.join(workspaceRoot, CpcConfig.filename);
        fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    }

    /**
     * Resolve template variables and relative paths.
     * - `${buildName}` → the buildName value
     * - relative paths → absolute paths resolved from wsRoot
     */
    static resolve(cfg: CpcProjectConfig, buildName: string, wsRoot: string): CpcProjectConfig {
        const sub = (s: string | undefined): string | undefined => {
            if (!s) return s;
            let r = s.replace(/\$\{buildName\}/g, buildName);
            // Make relative paths absolute
            if (r && !path.isAbsolute(r)) r = path.join(wsRoot, r);
            return r;
        };

        const result: CpcProjectConfig = { configuration: cfg.configuration };
        if (cfg.launch) {
            result.launch = {
                type:        cfg.launch.type,
                disk:        sub(cfg.launch.disk),
                diskB:       sub(cfg.launch.diskB),
                tape:        sub(cfg.launch.tape),
                snapshot:    sub(cfg.launch.snapshot),
                cartridge:   sub(cfg.launch.cartridge),
                symbolFile:  sub(cfg.launch.symbolFile),
                port:        cfg.launch.port,
            };
        }
        return result;
    }

    static default(buildName: string): CpcProjectConfig {
        return {
            configuration: "CPC6128FR",
            launch: {
                type:       "disk",
                disk:       `build/\${buildName}.dsk`,
                symbolFile: `build/\${buildName}.rasm`,
                port:       1234,
            },
        };
    }

    static defaultCartridge(buildName: string): CpcProjectConfig {
        return {
            configuration: "CPC6128PLUSEN",
            launch: {
                type:       "cartridge",
                cartridge:  `build/\${buildName}.cpr`,
                symbolFile: `build/\${buildName}.rasm`,
                port:       1234,
            },
        };
    }
}
