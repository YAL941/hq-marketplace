import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
    try {
        return await nextResolve(specifier, context);
    } catch (error) {
        if (specifier.startsWith('.') && specifier.endsWith('.js')) {
            try {
                return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
            } catch {
                // Preserve Node's original resolution diagnostic.
            }
        }
        throw error;
    }
}

export async function load(url, context, nextLoad) {
    if (!url.endsWith('.ts')) return nextLoad(url, context);
    const source = await readFile(new URL(url), 'utf8');
    const result = ts.transpileModule(source, {
        fileName: new URL(url).pathname,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        },
    });
    return { format: 'module', source: result.outputText, shortCircuit: true };
}
