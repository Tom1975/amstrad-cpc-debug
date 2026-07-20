import * as fs from "fs";

export interface LabelAnnotation {
    /** Inline comment on the label line, e.g. "; prints a null-terminated string" */
    comment: string;
    /** Standalone comment/blank lines immediately preceding the label, trimmed */
    preamble: string[];
    /** 1-based line number in the source file where this label is defined */
    lineNumber: number;
}

/** One entry in the sorted label-by-line index. */
export interface LabelLine {
    line: number;   // 1-based
    label: string;
}

/**
 * Extracts source-level annotations (comments) from a Z80 assembly file.
 *
 * For each label found in the source, records:
 *   - the block of comment/blank lines immediately before it (preamble)
 *   - the inline comment on the label line itself
 *
 * These annotations are used to enrich the disassembly view shown in VS Code.
 */
export class SourceAnnotations {
    private byLabel: Map<string, LabelAnnotation> = new Map();
    /** Labels sorted by ascending line number — used for nearest-label lookup. */
    private labelsByLine: LabelLine[] = [];

    getAnnotation(labelName: string): LabelAnnotation | undefined {
        return this.byLabel.get(labelName);
    }

    /**
     * Return the name of the label defined at or immediately before `line` (1-based).
     * Returns undefined if no label precedes the line in the file.
     */
    nearestLabelBefore(line: number): string | undefined {
        const arr = this.labelsByLine;
        if (arr.length === 0) return undefined;
        let lo = 0, hi = arr.length - 1, result: string | undefined;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid].line <= line) { result = arr[mid].label; lo = mid + 1; }
            else                       { hi = mid - 1; }
        }
        return result;
    }

    static fromFile(filePath: string): SourceAnnotations {
        const ann = new SourceAnnotations();
        let content: string;
        try {
            content = fs.readFileSync(filePath, "utf-8");
        } catch (e) {
            console.warn(`SourceAnnotations: cannot read ${filePath}:`, e);
            return ann;
        }

        const lines = content.split(/\r?\n/);
        let preamble: string[] = [];

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const lineNo = lineIdx + 1; // 1-based
            const trimmed = line.trim();

            // Standalone comment or blank line — accumulate as potential preamble
            if (trimmed.startsWith(";") || trimmed === "") {
                preamble.push(line.trimEnd());
                continue;
            }

            // Label at column 0 (RASM convention): "labelname:" optionally followed
            // by an instruction and/or a comment.
            // We only match labels starting at column 0 (no leading whitespace).
            const labelMatch = line.match(/^(\w+)\s*:(.*)/);
            if (labelMatch) {
                const labelName = labelMatch[1];
                const rest = labelMatch[2].trim();

                // Extract inline comment (everything from the first ";" onward)
                let inlineComment = "";
                const semicolonIdx = rest.indexOf(";");
                if (semicolonIdx !== -1) {
                    inlineComment = rest.slice(semicolonIdx).trim();
                }

                ann.byLabel.set(labelName, {
                    comment: inlineComment,
                    preamble: trimPreamble(preamble),
                    lineNumber: lineNo,
                });
                ann.labelsByLine.push({ line: lineNo, label: labelName });

                // Reset preamble after consuming it
                preamble = [];
                continue;
            }

            // Any other line (instruction, directive) — reset preamble accumulator
            preamble = [];
        }

        console.log(`SourceAnnotations: ${ann.byLabel.size} annotated label(s) from ${filePath}`);
        return ann;
    }
}

/** Remove leading and trailing blank lines from a preamble block. */
function trimPreamble(lines: string[]): string[] {
    let start = 0;
    while (start < lines.length && lines[start].trim() === "") start++;
    let end = lines.length - 1;
    while (end >= start && lines[end].trim() === "") end--;
    return lines.slice(start, end + 1);
}
