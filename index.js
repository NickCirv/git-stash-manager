#!/usr/bin/env node
/**
 * git-stash-manager (gsm)
 * Interactive TUI for browsing, previewing, and managing git stashes.
 * Zero external dependencies — built-ins only.
 */

import { execFileSync, spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { stdout, stdin, exit, argv } from 'process';
import { platform } from 'os';

const VERSION = '1.0.0';

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = '\x1b[';
const ANSI = {
  reset:      '\x1b[0m',
  bold:       '\x1b[1m',
  dim:        '\x1b[2m',
  italic:     '\x1b[3m',
  underline:  '\x1b[4m',
  // fg
  black:      '\x1b[30m',
  red:        '\x1b[31m',
  green:      '\x1b[32m',
  yellow:     '\x1b[33m',
  blue:       '\x1b[34m',
  magenta:    '\x1b[35m',
  cyan:       '\x1b[36m',
  white:      '\x1b[37m',
  gray:       '\x1b[90m',
  brightRed:   '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow:'\x1b[93m',
  brightBlue:  '\x1b[94m',
  brightCyan:  '\x1b[96m',
  brightWhite: '\x1b[97m',
  // bg
  bgBlack:    '\x1b[40m',
  bgRed:      '\x1b[41m',
  bgGreen:    '\x1b[42m',
  bgBlue:     '\x1b[44m',
  bgMagenta:  '\x1b[45m',
  bgCyan:     '\x1b[46m',
  bgWhite:    '\x1b[47m',
  bgGray:     '\x1b[100m',
  bgBrightBlue: '\x1b[104m',
};

const c = (color, text) => `${ANSI[color]}${text}${ANSI.reset}`;
const bold = (text) => `${ANSI.bold}${text}${ANSI.reset}`;
const dim  = (text) => `${ANSI.dim}${text}${ANSI.reset}`;

// Cursor / screen helpers
const cursor = {
  hide:     () => stdout.write('\x1b[?25l'),
  show:     () => stdout.write('\x1b[?25h'),
  home:     () => stdout.write('\x1b[H'),
  clear:    () => stdout.write('\x1b[2J\x1b[H'),
  moveTo:   (row, col) => stdout.write(`\x1b[${row};${col}H`),
  clearLine:() => stdout.write('\x1b[2K'),
  up:       (n=1) => stdout.write(`\x1b[${n}A`),
};

// ─── Unicode box drawing ──────────────────────────────────────────────────────

const BOX = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│',
  tee_l: '├', tee_r: '┤', tee_t: '┬', tee_b: '┴',
  cross: '┼',
};

function drawBox(x, y, w, h, title = '', color = 'cyan') {
  const lines = [];
  const titleStr = title ? ` ${title} ` : '';
  const topFill = titleStr
    ? BOX.h.repeat(2) + titleStr + BOX.h.repeat(w - 2 - titleStr.length - 2)
    : BOX.h.repeat(w - 2);
  lines.push(`${ANSI[color]}${BOX.tl}${topFill}${BOX.tr}${ANSI.reset}`);
  for (let i = 0; i < h - 2; i++) {
    lines.push(`${ANSI[color]}${BOX.v}${ANSI.reset}${' '.repeat(w - 2)}${ANSI[color]}${BOX.v}${ANSI.reset}`);
  }
  lines.push(`${ANSI[color]}${BOX.bl}${BOX.h.repeat(w - 2)}${BOX.br}${ANSI.reset}`);
  for (let i = 0; i < lines.length; i++) {
    cursor.moveTo(y + i, x);
    stdout.write(lines[i]);
  }
}

function writeAt(row, col, text) {
  cursor.moveTo(row, col);
  stdout.write(text);
}

// Strip ANSI for length calculations
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padEnd(str, len) {
  const visible = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, len - visible));
}

function truncate(str, len) {
  const visible = stripAnsi(str);
  if (visible.length <= len) return str;
  return visible.slice(0, len - 1) + '…';
}

// ─── Git helpers (execFileSync / spawnSync ONLY) ──────────────────────────────

function isGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function gitCmd(...args) {
  try {
    const result = execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8' });
    return result.trim();
  } catch (e) {
    return '';
  }
}

function gitCmdLines(...args) {
  const out = gitCmd(...args);
  return out ? out.split('\n') : [];
}

/**
 * Parse stash list into structured objects.
 * git stash list --format="%gd|%gs|%ci|%cr"
 * stash@{0}|WIP on main: abc1234 message|2026-03-03 10:00:00 +0400|2 hours ago
 */
function getStashes() {
  const lines = gitCmdLines(
    'stash', 'list',
    '--format=%gd\x1f%gs\x1f%ci\x1f%cr\x1f%gD'
  );
  return lines
    .filter(l => l.trim())
    .map(line => {
      const parts = line.split('\x1f');
      const ref    = parts[0] || '';           // stash@{0}
      const subject= parts[1] || '';           // "WIP on main: abc msg"
      const date   = parts[2] || '';           // ISO date
      const relDate= parts[3] || '';           // "2 hours ago"
      const fullRef= parts[4] || ref;

      const indexMatch = ref.match(/\{(\d+)\}/);
      const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;

      // "WIP on branch: commit msg" or "On branch: msg"
      let branch = 'unknown';
      let message = subject;
      const onMatch = subject.match(/^(?:WIP on|On) ([^:]+):\s*(.+)$/);
      if (onMatch) {
        branch  = onMatch[1].trim();
        message = onMatch[2].trim();
      }

      // Get file count
      let fileCount = 0;
      try {
        const diffNames = execFileSync('git', ['stash', 'show', '--name-only', ref], {
          stdio: 'pipe', encoding: 'utf8'
        }).trim();
        fileCount = diffNames ? diffNames.split('\n').filter(Boolean).length : 0;
      } catch { /* empty stash or error */ }

      return { ref, index, branch, message, date, relDate, fileCount, fullRef };
    });
}

function getStashDiff(ref) {
  try {
    return execFileSync('git', ['stash', 'show', '-p', '--color=never', ref], {
      stdio: 'pipe', encoding: 'utf8'
    });
  } catch {
    return '';
  }
}

function getStashFiles(ref) {
  try {
    const out = execFileSync('git', ['stash', 'show', '--name-status', ref], {
      stdio: 'pipe', encoding: 'utf8'
    });
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [status, ...rest] = line.split('\t');
      return { status: status.trim(), file: rest.join('\t').trim() };
    });
  } catch {
    return [];
  }
}

function applyStash(ref) {
  const r = spawnSync('git', ['stash', 'apply', ref], { stdio: 'pipe', encoding: 'utf8' });
  return { success: r.status === 0, output: (r.stdout + r.stderr).trim() };
}

function dropStash(ref) {
  const r = spawnSync('git', ['stash', 'drop', ref], { stdio: 'pipe', encoding: 'utf8' });
  return { success: r.status === 0, output: (r.stdout + r.stderr).trim() };
}

function pushStash(message) {
  const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
  const r = spawnSync('git', args, { stdio: 'pipe', encoding: 'utf8' });
  return { success: r.status === 0, output: (r.stdout + r.stderr).trim() };
}

function applyToBranch(ref, branchName) {
  // Create new branch from current HEAD
  let r = spawnSync('git', ['checkout', '-b', branchName], { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) return { success: false, output: (r.stdout + r.stderr).trim() };
  r = spawnSync('git', ['stash', 'apply', ref], { stdio: 'pipe', encoding: 'utf8' });
  return { success: r.status === 0, output: (r.stdout + r.stderr).trim() };
}

// ─── Diff colorizer ───────────────────────────────────────────────────────────

function colorizeDiff(raw) {
  const lines = raw.split('\n');
  return lines.map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return c('bold', line);
    }
    if (line.startsWith('+')) return `${ANSI.brightGreen}${line}${ANSI.reset}`;
    if (line.startsWith('-')) return `${ANSI.brightRed}${line}${ANSI.reset}`;
    if (line.startsWith('@@')) return `${ANSI.cyan}${line}${ANSI.reset}`;
    if (line.startsWith('diff ') || line.startsWith('index ')) {
      return `${ANSI.bold}${ANSI.blue}${line}${ANSI.reset}`;
    }
    return `${ANSI.dim}${line}${ANSI.reset}`;
  }).join('\n');
}

function fileStatusColor(status) {
  switch (status[0]) {
    case 'A': return ANSI.brightGreen;
    case 'D': return ANSI.brightRed;
    case 'M': return ANSI.brightYellow;
    case 'R': return ANSI.brightCyan;
    default:  return ANSI.white;
  }
}

// ─── Terminal size ────────────────────────────────────────────────────────────

function termSize() {
  const cols = stdout.columns || 120;
  const rows = stdout.rows    || 40;
  return { cols, rows };
}

// ─── Non-interactive commands ─────────────────────────────────────────────────

function cmdList() {
  if (!isGitRepo()) {
    console.error(c('red', 'Error: Not a git repository.'));
    exit(1);
  }
  const stashes = getStashes();
  if (stashes.length === 0) {
    console.log(dim('No stashes found.'));
    return;
  }
  console.log(bold(`\n  ${c('cyan', 'Git Stashes')} (${stashes.length} total)\n`));
  const header = `  ${'#'.padEnd(4)} ${'Branch'.padEnd(20)} ${'Files'.padEnd(6)} ${'Created'.padEnd(15)} Message`;
  console.log(c('gray', header));
  console.log(c('gray', '  ' + '─'.repeat(80)));
  for (const s of stashes) {
    const idx    = String(s.index).padEnd(4);
    const branch = s.branch.slice(0, 18).padEnd(20);
    const files  = String(s.fileCount).padEnd(6);
    const rel    = s.relDate.slice(0, 13).padEnd(15);
    const msg    = s.message.slice(0, 40);
    console.log(`  ${c('yellow', idx)} ${c('blue', branch)} ${c('magenta', files)} ${c('gray', rel)} ${msg}`);
  }
  console.log();
}

function cmdShow(n) {
  if (!isGitRepo()) { console.error(c('red', 'Not a git repository.')); exit(1); }
  const ref = `stash@{${n}}`;
  const diff = getStashDiff(ref);
  if (!diff) { console.error(c('red', `No stash at index ${n}.`)); exit(1); }
  console.log(colorizeDiff(diff));
}

function cmdApply(n) {
  if (!isGitRepo()) { console.error(c('red', 'Not a git repository.')); exit(1); }
  const ref = `stash@{${n}}`;
  const { success, output } = applyStash(ref);
  if (success) {
    console.log(c('green', `✓ Applied stash@{${n}}`));
    if (output) console.log(dim(output));
  } else {
    console.error(c('red', `Failed to apply stash@{${n}}`));
    console.error(output);
    exit(1);
  }
}

function cmdDrop(n) {
  if (!isGitRepo()) { console.error(c('red', 'Not a git repository.')); exit(1); }
  const ref = `stash@{${n}}`;
  const { success, output } = dropStash(ref);
  if (success) {
    console.log(c('green', `✓ Dropped stash@{${n}}`));
  } else {
    console.error(c('red', `Failed to drop stash@{${n}}`));
    console.error(output);
    exit(1);
  }
}

function cmdPush(message) {
  if (!isGitRepo()) { console.error(c('red', 'Not a git repository.')); exit(1); }
  const { success, output } = pushStash(message);
  if (success) {
    console.log(c('green', '✓ Stash created'));
    if (output) console.log(dim(output));
  } else {
    console.error(c('red', 'Failed to create stash'));
    console.error(output);
    exit(1);
  }
}

// ─── TUI state ────────────────────────────────────────────────────────────────

const state = {
  stashes:      [],
  selected:     0,
  diffLines:    [],
  diffScrollY:  0,
  mode:         'list',   // 'list' | 'preview' | 'confirm' | 'input' | 'help'
  confirmAction: null,    // { label, fn }
  inputPrompt:  '',
  inputValue:   '',
  inputCallback: null,
  statusMsg:    '',
  statusType:   'info',   // 'info' | 'success' | 'error'
  listScrollY:  0,
};

function loadStashes() {
  state.stashes = getStashes();
  if (state.selected >= state.stashes.length) {
    state.selected = Math.max(0, state.stashes.length - 1);
  }
}

function loadDiff() {
  if (state.stashes.length === 0) { state.diffLines = []; return; }
  const s    = state.stashes[state.selected];
  const raw  = getStashDiff(s.ref);
  const colored = raw ? colorizeDiff(raw) : dim('  (empty stash)');
  state.diffLines = colored.split('\n');
  state.diffScrollY = 0;
}

// ─── TUI render ───────────────────────────────────────────────────────────────

function render() {
  const { cols, rows } = termSize();
  cursor.clear();
  cursor.hide();

  const headerH = 3;
  const footerH = 2;
  const bodyH   = rows - headerH - footerH;

  // ── Header ──
  const title   = `${ANSI.bold}${ANSI.brightCyan}  git-stash-manager${ANSI.reset}  ${ANSI.dim}v${VERSION}${ANSI.reset}`;
  const repoInfo = c('gray', gitCmd('rev-parse', '--abbrev-ref', 'HEAD')
    ? `  branch: ${gitCmd('rev-parse','--abbrev-ref','HEAD')}` : '');
  writeAt(1, 1, title + repoInfo);
  writeAt(2, 1, c('gray', BOX.h.repeat(cols)));

  if (state.mode === 'help') {
    renderHelp(headerH + 1, bodyH, cols);
  } else if (state.mode === 'confirm') {
    renderList(headerH + 1, bodyH, Math.floor(cols / 2));
    renderConfirm(headerH + 1, bodyH, cols);
  } else if (state.mode === 'input') {
    renderList(headerH + 1, bodyH, Math.floor(cols / 2));
    renderInput(headerH + 1, bodyH, cols);
  } else {
    // Split: list left, diff right
    const listW = Math.min(50, Math.floor(cols * 0.4));
    const diffW = cols - listW - 1;
    renderList(headerH + 1, bodyH, listW);
    writeAt(headerH + 1, listW + 1, c('gray', BOX.v));
    for (let i = 1; i < bodyH - 1; i++) {
      writeAt(headerH + 1 + i, listW + 1, c('gray', BOX.v));
    }
    renderDiff(headerH + 1, bodyH, listW + 2, diffW);
  }

  // ── Footer / status ──
  renderFooter(rows - 1, cols);
  renderStatus(rows, cols);

  // Cursor stays hidden
}

function renderList(startRow, height, width) {
  const { stashes, selected, listScrollY } = state;
  const innerH = height - 2;

  // Box
  const title = ' Stashes ';
  const topBar = `${ANSI.cyan}${BOX.tl}${BOX.h}${title}${BOX.h.repeat(width - title.length - 3)}${BOX.tr}${ANSI.reset}`;
  writeAt(startRow, 1, topBar);
  for (let i = 0; i < innerH; i++) {
    writeAt(startRow + 1 + i, 1, `${ANSI.cyan}${BOX.v}${ANSI.reset}${' '.repeat(width - 2)}${ANSI.cyan}${BOX.v}${ANSI.reset}`);
  }
  writeAt(startRow + height - 1, 1, `${ANSI.cyan}${BOX.bl}${BOX.h.repeat(width - 2)}${BOX.br}${ANSI.reset}`);

  if (stashes.length === 0) {
    writeAt(startRow + Math.floor(innerH / 2), 3, dim('  No stashes found.'));
    return;
  }

  // Visible window
  const visibleCount = innerH;
  let scrollY = state.listScrollY;
  if (selected < scrollY) scrollY = selected;
  if (selected >= scrollY + visibleCount) scrollY = selected - visibleCount + 1;
  state.listScrollY = scrollY;

  for (let i = 0; i < visibleCount; i++) {
    const idx = scrollY + i;
    if (idx >= stashes.length) break;
    const s   = stashes[idx];
    const isSel = idx === selected;

    const prefix  = isSel ? `${ANSI.bgBlue}${ANSI.white} ▶ ` : '   ';
    const suffix  = isSel ? ANSI.reset : '';
    const refStr  = c(isSel ? 'brightWhite' : 'yellow', `[${s.index}]`);
    const branch  = truncate(s.branch, 12);
    const brStr   = (isSel ? ANSI.brightCyan : ANSI.cyan) + branch + ANSI.reset;
    const msg     = truncate(s.message, width - 22);
    const msgStr  = (isSel ? ANSI.white : '') + msg + ANSI.reset;
    const rel     = truncate(s.relDate, 10);
    const relStr  = ANSI.dim + rel + ANSI.reset;
    const files   = `${ANSI.magenta}${s.fileCount}f${ANSI.reset}`;

    const row   = startRow + 1 + i;
    const content = `${prefix}${refStr} ${brStr} ${files} ${suffix}`;
    writeAt(row, 2, content);

    // Second sub-line for message
    const msgLine = `${isSel ? ANSI.bgBlue : ''}   ${' '.repeat(0)}${msgStr}${ANSI.dim} · ${relStr}${isSel ? ANSI.reset : ''}`;
    // Fit into one line after the main info
    const combined = `${prefix}${refStr} ${brStr} ${files}  ${msgStr} ${ANSI.dim}${rel}${ANSI.reset}${suffix}`;
    writeAt(row, 2, combined + ' '.repeat(Math.max(0, width - 2 - stripAnsi(combined).length)));
  }

  // Scroll indicator
  if (stashes.length > visibleCount) {
    const pct = Math.round((scrollY / (stashes.length - visibleCount)) * 100);
    writeAt(startRow + height - 1, Math.floor(width / 2) - 4,
      `${ANSI.cyan}${BOX.bl}${ANSI.dim} ${pct}% ${ANSI.cyan}${BOX.h.repeat(width - 10)}${BOX.br}${ANSI.reset}`
    );
  }
}

function renderDiff(startRow, height, startCol, width) {
  const { stashes, selected, diffLines, diffScrollY } = state;

  const title = stashes.length
    ? ` Preview: stash@{${stashes[selected]?.index ?? 0}} `
    : ' Preview ';
  const topBar = `${ANSI.gray}${BOX.tl}${BOX.h}${title}${BOX.h.repeat(Math.max(0, width - title.length - 3))}${BOX.tr}${ANSI.reset}`;
  writeAt(startRow, startCol, topBar);

  const innerH = height - 2;

  for (let i = 0; i < innerH; i++) {
    const lineIdx = diffScrollY + i;
    const raw = diffLines[lineIdx] || '';
    const visible = stripAnsi(raw);
    const clipped = raw.slice(0, raw.length - Math.max(0, visible.length - (width - 4)));
    const padded  = padEnd(clipped, width - 2);
    writeAt(startRow + 1 + i, startCol, `${ANSI.gray}${BOX.v}${ANSI.reset} ${padded} ${ANSI.gray}${BOX.v}${ANSI.reset}`);
  }

  writeAt(startRow + height - 1, startCol,
    `${ANSI.gray}${BOX.bl}${BOX.h.repeat(width - 2)}${BOX.br}${ANSI.reset}`
  );

  // File list overlay (top-right of diff panel)
  if (stashes.length > 0) {
    const files = getStashFiles(stashes[selected].ref);
    const maxShow = Math.min(5, files.length);
    for (let i = 0; i < maxShow; i++) {
      const f = files[i];
      const col = fileStatusColor(f.status);
      const fName = truncate(f.file, 22);
      const line = `${col}${f.status} ${fName}${ANSI.reset}`;
      writeAt(startRow + 1 + i, startCol + width - 28, line);
    }
    if (files.length > maxShow) {
      writeAt(startRow + 1 + maxShow, startCol + width - 28,
        `${ANSI.dim}  +${files.length - maxShow} more${ANSI.reset}`);
    }
  }

  // Scroll hint
  if (diffLines.length > innerH) {
    const remaining = diffLines.length - diffScrollY - innerH;
    if (remaining > 0) {
      writeAt(startRow + height - 1, startCol + 2,
        `${ANSI.gray}${BOX.bl}${ANSI.dim} ↓ ${remaining} more lines ${ANSI.gray}${BOX.h.repeat(width - 22)}${BOX.br}${ANSI.reset}`
      );
    }
  }
}

function renderHelp(startRow, height, cols) {
  const w = Math.min(60, cols - 4);
  const x = Math.floor((cols - w) / 2);
  drawBox(x, startRow, w, height - 2, ' Help ', 'brightCyan');

  const helps = [
    ['Navigation', ''],
    ['↑ / k',         'Move up'],
    ['↓ / j',         'Move down'],
    ['Page Up/Down',  'Scroll diff'],
    ['', ''],
    ['Actions', ''],
    ['p',  'Toggle preview focus'],
    ['a',  'Apply stash (keep it)'],
    ['d',  'Drop / delete stash'],
    ['s',  'Save new stash'],
    ['b',  'Apply to new branch'],
    ['', ''],
    ['Other', ''],
    ['?',  'Toggle this help'],
    ['q',  'Quit'],
    ['Ctrl+C', 'Force quit'],
  ];

  let row = startRow + 2;
  for (const [key, desc] of helps) {
    if (!key && !desc) { row++; continue; }
    if (!desc) {
      writeAt(row, x + 2, `${ANSI.bold}${ANSI.brightCyan}${key}${ANSI.reset}`);
    } else {
      writeAt(row, x + 2, `${ANSI.yellow}${key.padEnd(18)}${ANSI.reset}${desc}`);
    }
    row++;
  }
}

function renderConfirm(startRow, height, cols) {
  const { confirmAction } = state;
  const msg  = confirmAction?.label || 'Are you sure?';
  const w    = Math.max(msg.length + 10, 40);
  const x    = Math.floor((cols - w) / 2);
  const y    = startRow + Math.floor(height / 2) - 4;

  drawBox(x, y, w, 7, ' Confirm ', 'brightRed');
  writeAt(y + 2, x + 2, msg);
  writeAt(y + 4, x + 2, `${ANSI.green}[Y] Yes${ANSI.reset}   ${ANSI.red}[N] No${ANSI.reset}`);
}

function renderInput(startRow, height, cols) {
  const { inputPrompt, inputValue } = state;
  const w = Math.max(inputPrompt.length + 10, 50);
  const x = Math.floor((cols - w) / 2);
  const y = startRow + Math.floor(height / 2) - 3;

  drawBox(x, y, w, 6, ' Input ', 'brightYellow');
  writeAt(y + 2, x + 2, inputPrompt);
  writeAt(y + 3, x + 2, `${ANSI.white}> ${inputValue}${ANSI.brightCyan}▌${ANSI.reset}`);
  writeAt(y + 4, x + 2, `${ANSI.dim}Enter to confirm, Esc to cancel${ANSI.reset}`);
}

function renderFooter(row, cols) {
  const keys = [
    ['↑↓', 'navigate'],
    ['p', 'preview'],
    ['a', 'apply'],
    ['d', 'drop'],
    ['s', 'save'],
    ['b', 'branch'],
    ['?', 'help'],
    ['q', 'quit'],
  ];
  const parts = keys.map(([k, v]) =>
    `${ANSI.bgGray}${ANSI.white} ${k} ${ANSI.reset}${ANSI.dim} ${v}${ANSI.reset}`
  );
  const bar = '  ' + parts.join('  ');
  writeAt(row, 1, bar + ' '.repeat(Math.max(0, cols - stripAnsi(bar).length)));
}

function renderStatus(row, cols) {
  if (!state.statusMsg) {
    writeAt(row, 1, ' '.repeat(cols));
    return;
  }
  const color = state.statusType === 'success' ? 'brightGreen'
              : state.statusType === 'error'   ? 'brightRed'
              : 'brightCyan';
  const msg = truncate(state.statusMsg, cols - 2);
  writeAt(row, 1, `${ANSI[color]} ● ${ANSI.reset}${msg}` + ' '.repeat(Math.max(0, cols - stripAnsi(msg).length - 3)));
}

function setStatus(msg, type = 'info') {
  state.statusMsg  = msg;
  state.statusType = type;
}

// ─── Input handling ───────────────────────────────────────────────────────────

function promptInput(prompt, callback) {
  state.mode         = 'input';
  state.inputPrompt  = prompt;
  state.inputValue   = '';
  state.inputCallback = callback;
  render();
}

function promptConfirm(label, fn) {
  state.mode          = 'confirm';
  state.confirmAction = { label, fn };
  render();
}

// ─── Key handlers ─────────────────────────────────────────────────────────────

function handleKey(key) {
  // Global
  if (key === '\x03') { cleanup(); exit(0); }   // Ctrl+C

  if (state.mode === 'input') {
    handleInputKey(key);
    return;
  }
  if (state.mode === 'confirm') {
    handleConfirmKey(key);
    return;
  }
  if (state.mode === 'help') {
    state.mode = 'list';
    render();
    return;
  }

  // Normal mode
  switch (key) {
    case '\x1b[A': case 'k': // up
      if (state.selected > 0) { state.selected--; loadDiff(); render(); }
      break;
    case '\x1b[B': case 'j': // down
      if (state.selected < state.stashes.length - 1) { state.selected++; loadDiff(); render(); }
      break;
    case '\x1b[5~': // Page Up
      state.diffScrollY = Math.max(0, state.diffScrollY - 10);
      render();
      break;
    case '\x1b[6~': // Page Down
      state.diffScrollY = Math.min(
        Math.max(0, state.diffLines.length - 10),
        state.diffScrollY + 10
      );
      render();
      break;
    case 'p': // preview focus toggle (scroll diff)
      state.diffScrollY = 0;
      setStatus('Preview focused — PgUp/PgDn to scroll', 'info');
      render();
      break;
    case 'a': // apply
      if (state.stashes.length === 0) return;
      doApply();
      break;
    case 'd': // drop
      if (state.stashes.length === 0) return;
      doDrop();
      break;
    case 's': // save new stash
      doSave();
      break;
    case 'b': // apply to new branch
      if (state.stashes.length === 0) return;
      doBranch();
      break;
    case '?': case 'h':
      state.mode = 'help';
      render();
      break;
    case 'q': case 'Q':
      cleanup(); exit(0);
      break;
  }
}

function handleInputKey(key) {
  if (key === '\r' || key === '\n') {
    const val = state.inputValue;
    state.mode = 'list';
    state.inputValue = '';
    if (state.inputCallback) state.inputCallback(val);
    return;
  }
  if (key === '\x1b') { // Escape
    state.mode = 'list';
    state.inputValue = '';
    setStatus('Cancelled', 'info');
    render();
    return;
  }
  if (key === '\x7f' || key === '\b') { // Backspace
    state.inputValue = state.inputValue.slice(0, -1);
    render();
    return;
  }
  // Printable chars
  if (key.length === 1 && key >= ' ') {
    state.inputValue += key;
    render();
  }
}

function handleConfirmKey(key) {
  if (key === 'y' || key === 'Y') {
    const fn = state.confirmAction?.fn;
    state.mode = 'list';
    state.confirmAction = null;
    if (fn) fn();
    return;
  }
  state.mode = 'list';
  state.confirmAction = null;
  setStatus('Cancelled', 'info');
  render();
}

// ─── TUI actions ──────────────────────────────────────────────────────────────

function doApply() {
  const s   = state.stashes[state.selected];
  const { success, output } = applyStash(s.ref);
  if (success) {
    setStatus(`✓ Applied stash@{${s.index}}: ${s.message}`, 'success');
  } else {
    setStatus(`✗ Apply failed: ${output}`, 'error');
  }
  loadStashes(); loadDiff(); render();
}

function doDrop() {
  const s = state.stashes[state.selected];
  promptConfirm(`Drop stash@{${s.index}}: "${truncate(s.message, 30)}"?`, () => {
    const { success, output } = dropStash(s.ref);
    if (success) {
      setStatus(`✓ Dropped stash@{${s.index}}`, 'success');
    } else {
      setStatus(`✗ Drop failed: ${output}`, 'error');
    }
    loadStashes(); loadDiff(); render();
  });
}

function doSave() {
  promptInput('Stash message (optional, Enter to skip):', (msg) => {
    const { success, output } = pushStash(msg || '');
    if (success) {
      setStatus(`✓ Stash saved${msg ? ': ' + msg : ''}`, 'success');
    } else {
      setStatus(`✗ Save failed: ${output}`, 'error');
    }
    loadStashes(); loadDiff(); render();
  });
}

function doBranch() {
  const s = state.stashes[state.selected];
  promptInput(`New branch name to apply stash@{${s.index}}:`, (branchName) => {
    if (!branchName.trim()) { setStatus('Cancelled — no branch name given', 'info'); render(); return; }
    const { success, output } = applyToBranch(s.ref, branchName.trim());
    if (success) {
      setStatus(`✓ Applied stash@{${s.index}} to new branch: ${branchName}`, 'success');
    } else {
      setStatus(`✗ Failed: ${output}`, 'error');
    }
    loadStashes(); loadDiff(); render();
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanup() {
  cursor.show();
  cursor.clear();
  if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
  stdout.write(ANSI.reset);
}

// ─── Launch TUI ───────────────────────────────────────────────────────────────

function launchTUI() {
  if (!isGitRepo()) {
    console.error(c('red', '\n  ✗ Not a git repository.\n'));
    console.error(dim('  Run git-stash-manager from inside a git repo.\n'));
    exit(1);
  }

  // Alternate screen buffer
  stdout.write('\x1b[?1049h');
  cursor.hide();

  loadStashes();
  loadDiff();
  render();

  if (!stdin.isTTY) {
    console.error(c('red', 'stdin is not a TTY — cannot launch interactive TUI.'));
    console.error(dim('Use non-interactive commands: gsm list, gsm show <n>, etc.'));
    cleanup();
    exit(1);
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  stdin.on('data', (key) => {
    handleKey(key);
  });

  // Handle resize
  stdout.on('resize', () => render());

  process.on('exit', () => {
    stdout.write('\x1b[?1049l'); // Restore normal screen
    cleanup();
  });

  process.on('SIGINT',  () => { cleanup(); stdout.write('\x1b[?1049l'); exit(0); });
  process.on('SIGTERM', () => { cleanup(); stdout.write('\x1b[?1049l'); exit(0); });
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${bold(c('cyan', 'git-stash-manager'))} ${dim(`v${VERSION}`)}
${dim('Interactive TUI for browsing, previewing, and managing git stashes.')}

${bold('USAGE')}
  gsm                        Launch interactive TUI
  gsm list                   List all stashes (non-interactive)
  gsm show <n>               Show diff for stash n
  gsm apply <n>              Apply stash n (keep it)
  gsm drop <n>               Drop stash n
  gsm push [--message <msg>] Create a new stash

${bold('TUI KEYS')}
  ↑ ↓ / j k   Navigate stash list
  p            Preview / reset diff scroll
  a            Apply selected stash
  d            Drop selected stash (with confirmation)
  s            Save new stash (prompt for message)
  b            Apply to new branch (prompt for name)
  PgUp/PgDn   Scroll diff preview
  ?            Show help overlay
  q            Quit

${bold('OPTIONS')}
  --help, -h   Show this help
  --version    Show version

${bold('EXAMPLES')}
  gsm                 # Interactive TUI
  gsm list            # Print stash list
  gsm show 0          # Show diff for stash@{0}
  gsm apply 2         # Apply stash@{2}
  gsm drop 1          # Drop stash@{1}
  gsm push -m "WIP"   # Create stash with message
`);
}

const args = argv.slice(2);
const cmd  = args[0];

if (!cmd || cmd === '--tui') {
  launchTUI();
} else if (cmd === '--help' || cmd === '-h') {
  printHelp();
} else if (cmd === '--version') {
  console.log(VERSION);
} else if (cmd === 'list') {
  cmdList();
} else if (cmd === 'show') {
  const n = parseInt(args[1], 10);
  if (isNaN(n)) { console.error(c('red', 'Usage: gsm show <stash-index>')); exit(1); }
  cmdShow(n);
} else if (cmd === 'apply') {
  const n = parseInt(args[1], 10);
  if (isNaN(n)) { console.error(c('red', 'Usage: gsm apply <stash-index>')); exit(1); }
  cmdApply(n);
} else if (cmd === 'drop') {
  const n = parseInt(args[1], 10);
  if (isNaN(n)) { console.error(c('red', 'Usage: gsm drop <stash-index>')); exit(1); }
  cmdDrop(n);
} else if (cmd === 'push') {
  const mIdx = args.indexOf('--message');
  const mIdx2 = args.indexOf('-m');
  const msgIdx = mIdx !== -1 ? mIdx : mIdx2;
  const message = msgIdx !== -1 ? args[msgIdx + 1] : '';
  cmdPush(message);
} else {
  console.error(c('red', `Unknown command: ${cmd}`));
  printHelp();
  exit(1);
}
