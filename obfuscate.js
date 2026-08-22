/**
 * Pre-build obfuscation script.
 * 
 * Copies source files to a temporary directory, obfuscates all JavaScript,
 * minifies HTML/CSS, then runs electron-builder against the obfuscated copy.
 * 
 * Usage: node obfuscate.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');
const CleanCSS = require('clean-css');
const { minify: minifyHTML } = require('html-minifier-terser');

// ─── Config ─────────────────────────────────────────────────────────────────
const ROOT = __dirname;
const TEMP = path.join(ROOT, 'build-temp');

// Files / dirs to copy into build-temp (relative to ROOT)
const SOURCE_ENTRIES = [
    'main.js',
    'preload.js',
    'src',
    'converters',
    'package.json',
    'package-lock.json',
    'node_modules',
    'build',
    'succes sound.mp3',
    'failed.mp3',
    'yt-dlp.exe'
];

// Obfuscator options — balanced between protection and performance
const OBFUSCATOR_OPTIONS = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    debugProtection: false,           // Can freeze DevTools – leave off
    disableConsoleOutput: false,       // Keep console for debugging in production
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,             // Avoid breaking Node.js globals
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 5,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

// CleanCSS options
const cleanCSS = new CleanCSS({ level: 2 });

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        ensureDir(dest);
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

function removeRecursive(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function getAllFiles(dir, ext) {
    let results = [];
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            // Skip node_modules — we don't obfuscate dependencies
            if (entry === 'node_modules') continue;
            results = results.concat(getAllFiles(full, ext));
        } else if (full.endsWith(ext)) {
            results.push(full);
        }
    }
    return results;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔒 Starting obfuscated build...\n');

    // 1. Clean previous temp dir
    console.log('1/5  Cleaning previous build-temp...');
    removeRecursive(TEMP);
    ensureDir(TEMP);

    // 2. Copy source files
    console.log('2/5  Copying source files to build-temp...');
    for (const entry of SOURCE_ENTRIES) {
        const src = path.join(ROOT, entry);
        const dest = path.join(TEMP, entry);
        if (fs.existsSync(src)) {
            console.log(`     ├─ ${entry}`);
            copyRecursive(src, dest);
        } else {
            console.log(`     ├─ ${entry} (skipped — not found)`);
        }
    }

    // 3. Obfuscate JavaScript files
    console.log('\n3/5  Obfuscating JavaScript files...');
    const jsFiles = getAllFiles(TEMP, '.js');
    let obfuscated = 0;
    for (const file of jsFiles) {
        const rel = path.relative(TEMP, file);
        try {
            const code = fs.readFileSync(file, 'utf8');
            const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
            fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
            obfuscated++;
            console.log(`     ├─ ✓ ${rel}`);
        } catch (err) {
            console.error(`     ├─ ✗ ${rel} — ${err.message}`);
        }
    }
    console.log(`     └─ ${obfuscated}/${jsFiles.length} files obfuscated`);

    // 4. Minify CSS files
    console.log('\n4/5  Minifying CSS & HTML...');
    const cssFiles = getAllFiles(TEMP, '.css');
    for (const file of cssFiles) {
        const rel = path.relative(TEMP, file);
        try {
            const code = fs.readFileSync(file, 'utf8');
            const result = cleanCSS.minify(code);
            if (result.styles) {
                fs.writeFileSync(file, result.styles, 'utf8');
                console.log(`     ├─ ✓ ${rel} (CSS)`);
            }
        } catch (err) {
            console.error(`     ├─ ✗ ${rel} — ${err.message}`);
        }
    }

    // 4b. Minify HTML files
    const htmlFiles = getAllFiles(TEMP, '.html');
    for (const file of htmlFiles) {
        const rel = path.relative(TEMP, file);
        try {
            const code = fs.readFileSync(file, 'utf8');
            const result = await minifyHTML(code, {
                collapseWhitespace: true,
                removeComments: true,
                removeRedundantAttributes: true,
                removeEmptyAttributes: true,
                minifyCSS: true,
                minifyJS: true
            });
            fs.writeFileSync(file, result, 'utf8');
            console.log(`     ├─ ✓ ${rel} (HTML)`);
        } catch (err) {
            console.error(`     ├─ ✗ ${rel} — ${err.message}`);
        }
    }

    // 5. Run electron-builder from the temp directory
    console.log('\n5/5  Running electron-builder...');
    try {
        execSync('npx electron-builder --win', {
            cwd: TEMP,
            stdio: 'inherit',
            env: { ...process.env }
        });
    } catch (err) {
        console.error('\n❌ electron-builder failed!');
        process.exit(1);
    }

    // 6. Copy dist output back to the main project
    const tempDist = path.join(TEMP, 'dist');
    const mainDist = path.join(ROOT, 'dist');
    if (fs.existsSync(tempDist)) {
        console.log('\n📦 Copying build output to dist/...');
        copyRecursive(tempDist, mainDist);
    }

    // 7. Clean up
    console.log('🧹 Cleaning up build-temp...');
    removeRecursive(TEMP);

    console.log('\n✅ Obfuscated build complete!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
