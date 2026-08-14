// Post-generation code validator and auto-fixer
// Repairs common AI-generated JavaScript/JSX errors
// and validates the final code using Babel.

import { parse } from "@babel/parser";

// Void HTML elements that must be self-closed in JSX
const VOID_ELEMENTS = [
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
];

/**
 * Validate JavaScript / JSX syntax using Babel.
 *
 * This catches errors that regex-based fixes cannot detect,
 * such as malformed JSX, missing closing brackets, invalid
 * JSX attributes, unexpected tokens, etc.
 */
function validateJavaScriptSyntax(code, filePath) {
    if (!filePath.endsWith(".js") && !filePath.endsWith(".jsx")) {
        return;
    }

    try {
        parse(code, {
            sourceType: "module",
            plugins: ["jsx"],
        });
    } catch (error) {
        throw new Error(
            `Invalid JavaScript/JSX in ${filePath}: ${error.message}`
        );
    }
}

/**
 * Validate and auto-fix common AI-generated code issues.
 */
export function validateAndFixCode(code, filePath, context) {
    const warnings = [];

    const isCSS = filePath.endsWith(".css");
    const isJS = filePath.endsWith(".js") || filePath.endsWith(".jsx");

    // ---------------------------------------------------------
    // 1. Remove markdown code fences
    // ---------------------------------------------------------

    const fencePattern =
        /^```(?:jsx?|javascript|css|html|tsx?|react)?\s*\n([\s\S]*?)\n```\s*$/;

    const fenceMatch = code.match(fencePattern);

    if (fenceMatch) {
        code = fenceMatch[1];

        warnings.push(
            `${filePath}: Stripped markdown code fences`
        );
    }

    // Handle fences at the beginning/end
    code = code.replace(
        /^```(?:jsx?|javascript|css|html|tsx?|react)?\s*\n/,
        ""
    );

    code = code.replace(
        /\n```\s*$/,
        ""
    );

    // ---------------------------------------------------------
    // CSS
    // ---------------------------------------------------------

    if (isCSS) {
        return {
            code: code.trim() + "\n",
            warnings,
        };
    }

    // ---------------------------------------------------------
    // Ignore unknown file types
    // ---------------------------------------------------------

    if (!isJS) {
        return {
            code,
            warnings,
        };
    }

    // =========================================================
    // JAVASCRIPT / JSX FIXES
    // =========================================================

    // ---------------------------------------------------------
    // 2. Fix class= → className=
    // ---------------------------------------------------------

    const classFixRegex =
        /(<[a-zA-Z][^>]*?)\bclass=/g;

    if (classFixRegex.test(code)) {
        code = code.replace(
            /(<[a-zA-Z][^>]*?)\bclass=/g,
            "$1className="
        );

        warnings.push(
            `${filePath}: Fixed 'class=' → 'className='`
        );
    }

    // ---------------------------------------------------------
    // 3. Fix for= → htmlFor=
    // ---------------------------------------------------------

    const forFixRegex =
        /(<label[^>]*?)\bfor=/gi;

    if (forFixRegex.test(code)) {
        code = code.replace(
            /(<label[^>]*?)\bfor=/gi,
            "$1htmlFor="
        );

        warnings.push(
            `${filePath}: Fixed 'for=' → 'htmlFor='`
        );
    }

    // ---------------------------------------------------------
    // 4. Self-close void HTML elements
    // ---------------------------------------------------------

    for (const tag of VOID_ELEMENTS) {
        const voidRegex = new RegExp(
            `<${tag}(\\s[^>]*?)?(?<!/)>`,
            "gi"
        );

        if (voidRegex.test(code)) {
            code = code.replace(
                new RegExp(
                    `<${tag}(\\s[^>]*?)?(?<!/)>`,
                    "gi"
                ),
                (match, attrs) =>
                    `<${tag}${attrs || ""} />`
            );

            warnings.push(
                `${filePath}: Self-closed <${tag}> elements`
            );
        }
    }

    // ---------------------------------------------------------
    // 5. Ensure exactly one default export exists
    // ---------------------------------------------------------

    const defaultExportCount =
        (code.match(/export\s+default\s+/g) || []).length;

    if (defaultExportCount === 0) {
        const funcMatch = code.match(
            /^function\s+([A-Z]\w*)\s*\(/m
        );

        const constMatch = code.match(
            /^const\s+([A-Z]\w*)\s*=\s*(?:\(|function)/m
        );

        const componentName =
            funcMatch?.[1] ||
            constMatch?.[1];

        if (componentName) {
            // Check whether there is already a named export
            const namedExportRegex = new RegExp(
                `export\\s+(function|const)\\s+${componentName}`
            );

            if (namedExportRegex.test(code)) {
                code = code.replace(
                    new RegExp(
                        `export\\s+(function|const)\\s+${componentName}`
                    ),
                    `export default $1 ${componentName}`
                );
            } else {
                code =
                    code.trimEnd() +
                    `\n\nexport default ${componentName};\n`;
            }

            warnings.push(
                `${filePath}: Added missing default export for '${componentName}'`
            );
        }
    }

    // ---------------------------------------------------------
    // 6. Remove invalid HTML comments from JSX
    // ---------------------------------------------------------

    const htmlCommentRegex =
        /<!--[\s\S]*?-->/g;

    if (htmlCommentRegex.test(code)) {
        code = code.replace(
            htmlCommentRegex,
            ""
        );

        warnings.push(
            `${filePath}: Removed HTML comments (invalid in JSX)`
        );
    }

    // ---------------------------------------------------------
    // 7. Remove common TypeScript syntax
    // ---------------------------------------------------------

    // Remove React.FC annotations
    code = code.replace(
        /:\s*React\.FC(?:<[^>]*>)?\s*=/g,
        () => {
            warnings.push(
                `${filePath}: Removed TypeScript React.FC annotation`
            );

            return " =";
        }
    );

    // Remove simple function parameter types
    code = code.replace(
        /(\([^)]*?)\s*:\s*(?:string|number|boolean|any|object|void)\s*([,)])/g,
        (match, before, after) => {
            warnings.push(
                `${filePath}: Removed TypeScript type annotation`
            );

            return `${before}${after}`;
        }
    );

    // ---------------------------------------------------------
    // 8. Ensure React import exists when JSX is present
    // ---------------------------------------------------------

    const hasJSX =
        /<[A-Za-z]/.test(code);

    const hasReactImport =
        /import\s+React/.test(code);

    if (hasJSX && !hasReactImport) {
        code =
            `import React from 'react';\n` +
            code;

        warnings.push(
            `${filePath}: Added missing React import`
        );
    }

    // ---------------------------------------------------------
    // 9. Fix incorrect import paths
    // ---------------------------------------------------------

    if (context?.allPlannedFiles) {
        const fixResult = fixImportPaths(
            code,
            filePath,
            context.allPlannedFiles
        );

        code = fixResult.code;

        warnings.push(
            ...fixResult.warnings
        );
    }

    // ---------------------------------------------------------
    // 10. Final syntax validation
    // ---------------------------------------------------------

    code = code.trim() + "\n";

    validateJavaScriptSyntax(
        code,
        filePath
    );

    return {
        code,
        warnings,
    };
}

/**
 * Validate code used by revision operations.
 */
export function validateRevisionContent(
    content,
    filePath,
    op
) {
    // Delete operation has no content to validate
    if (op === "delete") {
        return {
            content,
            warnings: [],
        };
    }

    // Create operation gets full validation
    if (op === "create") {
        const result =
            validateAndFixCode(
                content,
                filePath
            );

        return {
            content: result.code,
            warnings: result.warnings,
        };
    }

    // ---------------------------------------------------------
    // Update operations
    // ---------------------------------------------------------

    const warnings = [];

    // Fix class → className
    const classFixRegex =
        /(<[a-zA-Z][^>]*?)\bclass=/g;

    if (classFixRegex.test(content)) {
        content = content.replace(
            /(<[a-zA-Z][^>]*?)\bclass=/g,
            "$1className="
        );

        warnings.push(
            `${filePath}: Fixed 'class=' → 'className=' in replacement`
        );
    }

    // Fix for → htmlFor
    const forFixRegex =
        /(<label[^>]*?)\bfor=/gi;

    if (forFixRegex.test(content)) {
        content = content.replace(
            /(<label[^>]*?)\bfor=/gi,
            "$1htmlFor="
        );

        warnings.push(
            `${filePath}: Fixed 'for=' → 'htmlFor=' in replacement`
        );
    }

    // Self-close void elements
    for (const tag of VOID_ELEMENTS) {
        const voidRegex = new RegExp(
            `<${tag}(\\s[^>]*?)?(?<!/)>`,
            "gi"
        );

        if (voidRegex.test(content)) {
            content = content.replace(
                new RegExp(
                    `<${tag}(\\s[^>]*?)?(?<!/)>`,
                    "gi"
                ),
                (match, attrs) =>
                    `<${tag}${attrs || ""} />`
            );

            warnings.push(
                `${filePath}: Self-closed <${tag}> in replacement`
            );
        }
    }

    return {
        content,
        warnings,
    };
}

// ============================================================
// IMPORT PATH RESOLUTION HELPERS
// ============================================================

function getDir(p) {
    const parts = p.split("/");

    parts.pop();

    return parts.join("/") || "/";
}

function resolvePath(
    baseDir,
    relativePath
) {
    const baseParts =
        baseDir
            .split("/")
            .filter(Boolean);

    const relParts =
        relativePath
            .split("/")
            .filter(Boolean);

    for (const part of relParts) {
        if (part === ".") {
            continue;
        }

        if (part === "..") {
            baseParts.pop();
        } else {
            baseParts.push(part);
        }
    }

    return "/" + baseParts.join("/");
}

function getRelativePath(
    fromDir,
    toPath
) {
    const fromParts =
        fromDir
            .split("/")
            .filter(Boolean);

    const toParts =
        toPath
            .split("/")
            .filter(Boolean);

    let commonLength = 0;

    while (
        commonLength < fromParts.length &&
        commonLength < toParts.length &&
        fromParts[commonLength] ===
            toParts[commonLength]
    ) {
        commonLength++;
    }

    const upCount =
        fromParts.length -
        commonLength;

    const remainingTo =
        toParts.slice(commonLength);

    const relParts = [];

    for (
        let i = 0;
        i < upCount;
        i++
    ) {
        relParts.push("..");
    }

    if (relParts.length === 0) {
        relParts.push(".");
    }

    relParts.push(
        ...remainingTo
    );

    return relParts.join("/");
}

function cleanExtension(p) {
    return p.replace(
        /\.(js|jsx|css|ts|tsx)$/,
        ""
    );
}

function fixImportPaths(
    code,
    filePath,
    allPlannedFiles
) {
    const warnings = [];

    if (
        !allPlannedFiles ||
        allPlannedFiles.length === 0
    ) {
        return {
            code,
            warnings,
        };
    }

    const currentDir =
        getDir(filePath);

    const plannedPaths =
        allPlannedFiles.map((f) =>
            f.path.startsWith("/")
                ? f.path
                : "/" + f.path
        );

    // Match:
    // import Header from './components/Header';
    // import '../styles.css';
    // require('./components/Header');

    const importRegex =
        /(from\s+['"]|import\s+['"])([^'"]+)(['"])/g;

    const newCode =
        code.replace(
            importRegex,
            (
                match,
                prefix,
                importTarget,
                suffix
            ) => {
                // Ignore package imports
                if (
                    !importTarget.startsWith(".")
                ) {
                    return match;
                }

                // Resolve relative path
                const resolvedTarget =
                    resolvePath(
                        currentDir,
                        importTarget
                    );

                const resolvedClean =
                    cleanExtension(
                        resolvedTarget
                    );

                // Check exact match
                const exactExists =
                    plannedPaths.some(
                        (p) =>
                            cleanExtension(p) ===
                            resolvedClean
                    );

                if (exactExists) {
                    return match;
                }

                // Find same filename
                const importFilename =
                    resolvedClean
                        .split("/")
                        .pop();

                if (!importFilename) {
                    return match;
                }

                const foundPlannedPath =
                    plannedPaths.find((p) => {
                        const plannedClean =
                            cleanExtension(p);

                        const plannedFilename =
                            plannedClean
                                .split("/")
                                .pop();

                        return (
                            plannedFilename ===
                            importFilename
                        );
                    });

                if (foundPlannedPath) {
                    const newRelative =
                        getRelativePath(
                            currentDir,
                            foundPlannedPath
                        );

                    const finalRelative =
                        newRelative.startsWith(".")
                            ? newRelative
                            : "./" + newRelative;

                    const hasExt =
                        /\.(js|jsx|css|ts|tsx)$/.test(
                            importTarget
                        );

                    const ext =
                        hasExt
                            ? "." +
                              importTarget
                                  .split(".")
                                  .pop()
                            : "";

                    const rewrittenTarget =
                        cleanExtension(
                            finalRelative
                        ) + ext;

                    if (
                        rewrittenTarget !==
                        importTarget
                    ) {
                        warnings.push(
                            `${filePath}: Corrected import '${importTarget}' to '${rewrittenTarget}' (file planned at '${foundPlannedPath}')`
                        );

                        return (
                            `${prefix}` +
                            `${rewrittenTarget}` +
                            `${suffix}`
                        );
                    }
                }

                return match;
            }
        );

    return {
        code: newCode,
        warnings,
    };
}