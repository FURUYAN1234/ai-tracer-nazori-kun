(() => {
  'use strict';
  const E = window.KomaEngine;
  const $ = id => document.getElementById(id);
  const slots = [
    ['sky', '空', '#e6b5a5', '#aaa3d3'],
    ['sun', '太陽', '#fff1b4', '#ffd2dd'],
    ['water', '水面', '#a3c1b3', '#8184b1'],
    ['coat', 'コートと帽子', '#d77664', '#545475'],
    ['hair', '髪', '#6b5556', '#493b63'],
    ['skin', '肌', '#f5caac', '#efbbc3'],
    ['accent', '差し色', '#f4bc69', '#d99cb5'],
    ['white', '白抜き', '#fffafa', '#fbf4ff'],
    ['eyes', '瞳', '#508b7c', '#73568d'],
  ];
  const limit = 8;
  const roleLimit = 300;
  const duration = 16700;
  const styles = ['g', 'fine', 'brush', 'original'];
  const quick = ['#f6bfad', '#f8ce78', '#a4ba86', '#528d98', '#797aba', '#ad6798', '#423752', '#fffafa'];
  let state;
  let history = [];
  let future = [];
  let colorModel;
  let selection = { index: 0, role: 'coat', variant: 'a', view: 'compare', tool: 'paint' };
  let splitStart = null;
  let replay = null;
  let busy = false;
  let recording = false;
  let exportSelection;
  const cache = new WeakMap();

  function canvas(width, height) {
    const result = document.createElement('canvas');
    result.width = width;
    result.height = height;
    return result;
  }

  function readInk(source) {
    const { width, height } = source;
    const rgba = source.getContext('2d').getImageData(0, 0, width, height).data;
    return E.inspectRaster(rgba, width, height);
  }

  async function startDemo() {
    const training = ['海風の配達員', '振り返る配達員'].map((name, i) => {
      const sample = window.KomaDemo(Boolean(i));
      return { ...readInk(sample.canvas), name, markers: sample.markers, barriers: [], traced: true };
    });
    colorModel = E.trainColorModel(training.map(panel => ({ layout: E.segment(panel, 180), markers: panel.markers })));
    const sourceList = [['モノクロ · 海風の配達員', 'examples/mono.png'],
      ['カラー · 港町の配達員', 'examples/color.png'],
      ['詳細モノクロ · 時計職人', 'examples/detailed-mono.png'],
      ['詳細カラー · 凧職人', 'examples/detailed-color.png']];
    const panels = await Promise.all(sourceList.map(async ([name, src]) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const sample = canvas(image.naturalWidth, image.naturalHeight);
      sample.getContext('2d').drawImage(image, 0, 0);
      return { ...readInk(sample), name, markers: [], barriers: [], traced: false };
    }));
    state = { name: '付属作例', threshold: 180, pen: 'g', strength: 100, demo: true,
      roles: defaultRoles(), panels };
    selection = { index: 0, role: 'coat', variant: 'a', view: 'compare', tool: 'paint' };
    history = [];
    future = [];
    splitStart = null;
    restoreSpeeds();
    render();
  }

  function defaultRoles() {
    return slots.map(([id, name, a, b]) => ({ id, name, a, b }));
  }

  function demoFailed() {
    if (state) return report('作例を読み取れませんでした。');
    const blank = canvas(360, 410);
    blank.getContext('2d').fillStyle = '#fff';
    blank.getContext('2d').fillRect(0, 0, 360, 410);
    state = { name: '原稿を追加してください', threshold: 180, pen: 'g', strength: 100, demo: true,
      roles: defaultRoles(), panels: [{ ...readInk(blank), name: '原稿', markers: [], barriers: [], traced: false }] };
    render();
    report('作例はローカルサーバーで開くと利用できます。画像は「原稿を追加」から開けます。');
  }

  function remember() {
    history.push({ state, selection: { ...selection } });
    if (history.length > 35) history.shift();
    future = [];
  }

  function modifyPanel(index, change) {
    remember();
    state = { ...state, panels: state.panels.map((panel, i) => i === index ? change(panel) : panel) };
    render();
  }

  function geometry(panel) {
    let result = cache.get(panel.ink);
    if (!result || result.threshold !== state.threshold) {
      const { contours, rebuilt } = E.rebuildInk(panel, state.threshold);
      result = { threshold: state.threshold, contours, rebuilt, styles: new Map() };
      cache.set(panel.ink, result);
    }
    if (result.barriers !== panel.barriers) {
      result.barriers = panel.barriers;
      result.layout = E.segment(panel, state.threshold, panel.barriers);
    }
    return result;
  }

  function styled(model) {
    const key = state.pen === 'g' ? 'g-' + state.strength : state.pen;
    if (!model.styles.has(key)) {
      if (model.styles.size >= 4) model.styles.delete(model.styles.keys().next().value);
      model.styles.set(key, E.stylizeInk(model.rebuilt, state.pen, state.strength / 100));
    }
    return model.styles.get(key);
  }

  function palette(variant) {
    return Object.fromEntries(state.roles.filter(role => !role.hidden).map(role => [role.id, role[variant]]));
  }

  function assignedColors(panel, layout) {
    return E.resolveColors(layout, panel.markers, panel.sourceRoles);
  }

  function pixels(ctx, panel, data) {
    ctx.putImageData(new ImageData(data, panel.width, panel.height), 0, 0);
  }

  function output(panel, mode, editing = false) {
    const result = canvas(panel.width, panel.height);
    const ctx = result.getContext('2d');
    if (mode === 'source' || !panel.traced) {
      pixels(ctx, panel, panel.rgba);
      return result;
    }
    const model = geometry(panel);
    const assignments = assignedColors(panel, model.layout);
    const colors = mode === 'ink' ? {} : palette(mode);
    const highlight = editing && $('highlight').checked ? selection.role : undefined;
    pixels(ctx, panel, E.paint(styled(model), model.layout, assignments, colors, { highlight }));
    if (editing && selection.tool === 'split') showBarriers(ctx, panel);
    return result;
  }

  function showBarriers(ctx, panel) {
    const unit = Math.max(1, panel.width / 310);
    ctx.lineWidth = 2 * unit;
    ctx.strokeStyle = '#ad377d';
    ctx.fillStyle = '#ad377d';
    ctx.setLineDash([4 * unit, 3 * unit]);
    for (const [x0, y0, x1, y1] of panel.barriers) {
      ctx.beginPath();
      ctx.moveTo(x0 + .5, y0 + .5);
      ctx.lineTo(x1 + .5, y1 + .5);
      ctx.stroke();
    }
    if (splitStart?.panel === panel) {
      ctx.beginPath();
      ctx.arc(splitStart.x, splitStart.y, 4 * unit, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function pointOnCanvas(event, image) {
    const box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const x = Math.floor((event.clientX - box.left - (box.width - image.width * scale) / 2) / scale);
    const y = Math.floor((event.clientY - box.top - (box.height - image.height * scale) / 2) / scale);
    if (x >= 0 && x < image.width && y >= 0 && y < image.height) return [x, y];
    return null;
  }

  function editCanvas(event, image, index, variant) {
    const point = pointOnCanvas(event, image);
    if (!point) return;
    const [x, y] = point;
    const panel = state.panels[index];
    selection.index = index;
    selection.variant = variant;
    if (selection.tool === 'split') {
      if (splitStart?.panel !== panel) {
        splitStart = { panel, x, y };
        render();
        return;
      }
      const start = splitStart;
      if (start.x === x && start.y === y) return;
      splitStart = null;
      modifyPanel(index, old => ({ ...old, barriers: [...old.barriers, [start.x, start.y, x, y]] }));
      report('塗り分け用の境界を追加しました。');
      return;
    }
    const { layout } = geometry(panel);
    const id = E.regionAt(layout, x, y);
    if (id <= 0) return report('線の内側を選んでください。');
    const current = assignedColors(panel, layout).get(id);
    if (selection.tool === 'pick') {
      if (!current) return report('この部分には色レイヤーがありません。');
      selection.role = current;
      render();
      const row = [...$('roles').children].find(child => child.dataset.role === current);
      row?.scrollIntoView({ block: 'nearest' });
      return report(state.roles.find(role => role.id === current).name + 'を選びました。');
    }
    const next = selection.tool === 'erase' ? undefined : selection.role;
    if (current === next) return;
    modifyPanel(index, old => {
      const markers = old.markers.filter(marker => E.regionAt(layout, marker.x, marker.y) !== id);
      const sourceRole = old.sourceRoles?.[layout.regions[id - 1].colorClass] ?? undefined;
      if (next !== sourceRole) markers.push({ x, y, role: next ?? null });
      return { ...old, markers };
    });
    report(next ? state.roles.find(role => role.id === next).name + 'を割り当てました。' : '色の割り当てを外しました。');
  }

  function figure(index, mode, title, caption) {
    const panel = state.panels[index];
    const editable = panel.traced && (mode === 'a' || mode === 'b');
    const image = output(panel, mode, editable);
    image.setAttribute('aria-label', panel.name + ' ' + title);
    const fig = document.createElement('figure');
    fig.className = editable ? 'art editable' : 'art';
    fig.dataset.variant = mode;
    const text = document.createElement('figcaption');
    const name = document.createElement('span');
    const extra = document.createElement('small');
    name.textContent = title;
    extra.textContent = caption;
    text.append(name, extra);
    fig.append(text, image);
    if (editable) image.addEventListener('click', event => editCanvas(event, image, index, mode));
    return fig;
  }

  function drawViews() {
    const { index, variant, view } = selection;
    $('view').classList.toggle('work-grid', view === 'works');
    if (view === 'works') {
      $('view').replaceChildren(...state.panels.map((panel, i) => workCard(panel, i, variant)));
    } else if (!state.panels[index].traced) {
      $('view').replaceChildren(figure(index, 'source', '取り込んだ原稿', 'トレス前'));
    } else if (view === 'ink') {
      const model = geometry(state.panels[index]);
      $('view').replaceChildren(figure(index, 'source', '取り込んだ原稿', state.panels[index].isColor ? 'カラー' : 'モノクロ'),
        figure(index, 'ink', '再構築した線', model.contours.length + ' 個の閉境界'));
    } else {
      $('view').replaceChildren(figure(index, 'a', '配色 A', '同じコマで比較'),
        figure(index, 'b', '配色 B', '同じコマで比較'));
    }
  }

  function workCard(panel, index, variant) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'work-card';
    card.setAttribute('aria-pressed', String(index === selection.index));
    const image = document.createElement('img');
    image.alt = '';
    image.src = thumbnail(panel, variant, 146, 132);
    const name = document.createElement('span');
    name.textContent = panel.name;
    const status = document.createElement('small');
    status.textContent = (panel.traced ? 'トレス済み' : '未トレス') + (index === selection.index ? ' · 選択中' : '');
    card.append(image, name, status);
    card.onclick = () => {
      selection.index = index;
      selection.view = panel.traced && panelHasColor(panel) ? 'compare' : 'ink';
      splitStart = null;
      render();
      $('panel-strip').children[index].focus({ preventScroll: true });
    };
    return card;
  }

  function thumbnail(panel, variant, width, height) {
    const thumb = canvas(width, height);
    const ctx = thumb.getContext('2d');
    const fit = Math.min(width / panel.width, height / panel.height);
    const w = panel.width * fit, h = panel.height * fit;
    ctx.drawImage(output(panel, variant), (width - w) / 2, (height - h) / 2, w, h);
    return thumb.toDataURL();
  }

  function panelHasColor(panel) {
    return panel.sourceRoles?.some(Boolean) || panel.markers.some(marker => marker.role);
  }

  function strip() {
    $('panel-strip').hidden = selection.view === 'works';
    $('panel-strip').replaceChildren(...state.panels.map((panel, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'panel-button';
      button.setAttribute('aria-pressed', String(i === selection.index));
      const image = document.createElement('img');
      image.alt = '';
      image.src = thumbnail(panel, selection.variant, 44, 46);
      const name = document.createElement('span');
      name.textContent = (i + 1) + ' · ' + panel.name;
      button.append(image, name);
      button.addEventListener('click', () => {
        closeReplay();
        selection.index = i;
        splitStart = null;
        render();
        $('panel-strip').children[i].focus({ preventScroll: true });
      });
      return button;
    }));
  }

  function renderRoles() {
    const panel = state.panels[selection.index];
    const usage = panel.traced ? assignedColors(panel, geometry(panel).layout) : new Map();
    const used = new Set(usage.values());
    const roles = [...state.roles].sort((a, b) => Number(used.has(b.id)) - Number(used.has(a.id)));
    const list = $('roles');
    const scroll = list.scrollTop;
    list.replaceChildren(...roles.map(role => {
      const row = document.createElement('div');
      row.className = 'role-row';
      row.dataset.role = role.id;
      if (used.has(role.id)) row.dataset.used = 'true';
      const name = document.createElement('button');
      name.type = 'button';
      name.textContent = role.name;
      name.setAttribute('aria-pressed', String(role.id === selection.role));
      name.addEventListener('click', () => {
        selection.role = role.id;
        selection.tool = 'paint';
        splitStart = null;
        render();
        [...list.children].find(child => child.dataset.role === role.id)?.firstElementChild.focus({ preventScroll: true });
      });
      row.append(name);
      for (const variant of ['a', 'b']) {
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = role[variant];
        picker.setAttribute('aria-label', role.name + ' 配色 ' + variant.toUpperCase());
        picker.addEventListener('change', () => recolor(role.id, variant, picker.value, true));
        row.append(picker);
      }
      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = !role.hidden;
      visible.setAttribute('aria-label', role.name + 'レイヤーを表示');
      visible.addEventListener('change', () => {
        remember();
        closeReplay();
        state = { ...state, roles: state.roles.map(item => item.id === role.id ? { ...item, hidden: !visible.checked } : item) };
        render(false);
        report(visible.checked ? '色レイヤーを表示しました。' : '色レイヤーを非表示にしました。');
      });
      row.append(visible);
      return row;
    }));
    list.scrollTop = scroll;
  }

  function recolor(id, variant, hex, refresh) {
    const role = state.roles.find(item => item.id === id);
    if (role[variant] === hex) return;
    remember();
    closeReplay();
    selection.role = id;
    selection.variant = variant;
    state = { ...state, roles: state.roles.map(item => item.id === id ? { ...item, [variant]: hex } : item) };
    render(refresh);
    report('同じ色グループを使うコマを更新しました。');
  }

  function renderQuick() {
    for (const variant of ['a', 'b']) $('quick-' + variant).setAttribute('aria-pressed', String(selection.variant === variant));
    const role = state.roles.find(item => item.id === selection.role);
    $('quick-colors').replaceChildren(...quick.map((hex, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', ['桜', '山吹', '若葉', '浅葱', '藤', '紅紫', '墨紫', '白'][i] + 'に変更');
      button.setAttribute('aria-pressed', String(role[selection.variant] === hex));
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = hex;
      button.append(swatch);
      button.onclick = () => recolor(role.id, selection.variant, hex, true);
      return button;
    }));
  }

  function render(refreshRoles = true) {
    $('project-name').textContent = state.name;
    $('threshold').value = state.threshold;
    $('threshold-value').textContent = state.threshold;
    $('undo').disabled = history.length === 0;
    $('redo').disabled = future.length === 0;
    $('pen').value = state.pen;
    $('strength').value = state.strength;
    $('strength-value').textContent = state.strength + '%';
    $('strength').disabled = state.pen !== 'g';
    const panel = state.panels[selection.index];
    $('export-target').textContent = panel.name;
    for (const id of ['psd', 'svg', 'coordinates']) $(id).disabled = !panel.traced;
    if (exportSelection?.ink !== panel.ink || exportSelection?.traced !== panel.traced) {
      exportSelection = panel;
      $('export-type').value = !panel.traced ? 'source' : panelHasColor(panel) ? selection.variant : 'ink';
    }
    $('export').disabled = !panel.traced && $('export-type').value !== 'source';
    updateSourceKind();
    for (const el of document.querySelectorAll('[data-view]')) el.setAttribute('aria-pressed', String(el.dataset.view === selection.view));
    for (const el of document.querySelectorAll('[data-tool]')) el.setAttribute('aria-pressed', String(el.dataset.tool === selection.tool));
    const selected = state.roles.find(role => role.id === selection.role);
    $('hint').textContent = selection.tool === 'split'
      ? (splitStart ? '次に、境界の終点をクリック。' : '塗り漏れを止めたい場所の始点と終点をクリック。')
      : selection.tool === 'erase' ? '色を外したい領域をクリック。'
        : selection.tool === 'pick' ? '変えたい色を絵の上でクリック。'
        : '「' + selected.name + '」にしたい領域をクリック。';
    if (refreshRoles) renderRoles();
    renderQuick();
    drawViews();
    strip();
  }

  function report(message) {
    $('status').textContent = message;
  }

  function updateSourceKind() {
    const panel = state.panels[selection.index];
    $('source-kind').textContent = (panel.isColor ? 'カラー原稿' : 'モノクロ原稿')
      + (replay && replay.position < 1 ? ' · 工程の再生中' : panel.traced ? ' · トレス済み' : ' · トレス前');
  }

  function download(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  }

  function saveProject() {
    const data = {
      format: 'koma-iro/1', name: state.name, threshold: state.threshold, pen: state.pen, strength: state.strength, roles: state.roles,
      preferences: { index: selection.index, variant: selection.variant, role: selection.role,
        drawSpeed: Number($('draw-speed').value), playbackSpeed: Number($('speed').value) },
      panels: state.panels.map(({ name, markers, sourceRoles, barriers, traced }, i) =>
        ({ name, markers, sourceRoles, barriers, traced, source: output(state.panels[i], 'source').toDataURL('image/png') })),
    };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'koma-iro-project.json');
    report('プロジェクトのダウンロードを開始しました。');
  }

  const colorPattern = /^#[0-9a-f]{6}$/i;
  const rolePattern = /^(?!constructor$|prototype$|__proto__$)[a-z][a-z0-9-]{0,45}$/;
  const title = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
  const coordinate = (n, size) => Number.isInteger(n) && n >= 0 && n < size;

  async function bitmapToInk(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG、JPEG、WebPを読み込めます。');
    if (file.size > 24 * 1024 * 1024) throw new Error('画像は1枚あたり24 MBまでです。');
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const image = canvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      image.getContext('2d').drawImage(bitmap, 0, 0, image.width, image.height);
      return readInk(image);
    } finally {
      bitmap.close();
    }
  }

  async function readProject(file) {
    if (file.size > 85 * 1024 * 1024) throw new Error('プロジェクトは85 MBまでです。');
    const data = JSON.parse(await file.text());
    if (!data || data.format !== 'koma-iro/1' || !title(data.name, 120)
        || !Number.isInteger(data.threshold) || data.threshold < 32 || data.threshold > 248
        || !Array.isArray(data.roles) || !data.roles.length || data.roles.length > roleLimit
        || !data.roles.every(role => role && typeof role.id === 'string' && rolePattern.test(role.id) && title(role.name, 24)
          && typeof role.a === 'string' && colorPattern.test(role.a) && typeof role.b === 'string' && colorPattern.test(role.b))
        || !Array.isArray(data.panels) || !data.panels.length || data.panels.length > limit) throw new Error('このアプリで保存したプロジェクトを選んでください。');
    const roles = new Set(data.roles.map(role => role.id));
    if (roles.size !== data.roles.length) throw new Error('色グループのIDが重複しています。');
    const panels = [];
    for (const panel of data.panels) {
      if (!panel || !title(panel.name, 120) || !Array.isArray(panel.markers) || panel.markers.length > 250000
          || !Array.isArray(panel.barriers) || panel.barriers.length > 3000 || typeof panel.source !== 'string'
          || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(panel.source))
        throw new Error('プロジェクトの原稿データが壊れています。');
      const bytes = Uint8Array.from(atob(panel.source.split(',')[1]), char => char.charCodeAt(0));
      const drawing = await bitmapToInk(new Blob([bytes], { type: 'image/png' }));
      const { width, height } = drawing;
      const sourceRoles = panel.sourceRoles ?? [];
      const validRole = role => role === null || roles.has(role);
      if (!Array.isArray(sourceRoles) || sourceRoles.length > 34 || !sourceRoles.every(validRole)
          || !panel.markers.every(marker => marker && coordinate(marker.x, width) && coordinate(marker.y, height) && validRole(marker.role))
          || !panel.barriers.every(line => Array.isArray(line) && line.length === 4 && line.every((value, i) => coordinate(value, i % 2 ? height : width))))
        throw new Error('塗り分けの位置データが壊れています。');
      panels.push({ name: panel.name, markers: panel.markers, sourceRoles, barriers: panel.barriers, traced: panel.traced !== false, ...drawing });
    }
    const strength = Number.isInteger(data.strength) && data.strength >= 0 && data.strength <= 100 ? data.strength : 100;
    return { name: data.name, threshold: data.threshold, pen: styles.includes(data.pen) ? data.pen : 'g', strength,
      roles: data.roles, panels, preferences: data.preferences };
  }

  async function readFiles(input, action) {
    const files = [...input.files];
    input.value = '';
    if (!files.length || busy) return;
    busy = true;
    $('import').disabled = $('open-project').disabled = true;
    try {
      await action(files);
    } catch (error) {
      report(error instanceof SyntaxError ? 'JSONを読み取れませんでした。' : error.message || 'ファイルを読み取れませんでした。');
    } finally {
      busy = false;
      $('import').disabled = $('open-project').disabled = false;
    }
  }

  function tracePanels() {
    if (busy) return;
    const pending = !state.panels[selection.index].traced;
    const targets = state.panels.map((_, i) => i === selection.index);
    const auto = $('auto-color').checked;
    closeReplay();
    splitStart = null;
    const active = state.panels[selection.index];
    if (!pending && panelHasColor(active)
      && !window.confirm('このコマの色の割り当てを作り直しますか？')) return;
    remember();
    const roles = [...state.roles];
    function importedRole(hex) {
      const exact = roles.find(role => role.a.toLowerCase() === hex);
      if (exact) return exact.id;
      if (roles.length < roleLimit) {
        const id = 'c-' + hex.slice(1);
        const existing = roles.find(role => role.id === id);
        if (existing) return existing.id;
        roles.push({ id, name: '原稿色 ' + hex, a: hex, b: hex });
        return id;
      }
      const channels = color => color.slice(1).match(/../g).map(channel => parseInt(channel, 16));
      const rgb = channels(hex);
      const score = role => channels(role.a).reduce((sum, value, i) => sum + (value - rgb[i]) ** 2, 0);
      return roles.reduce((best, role) => score(role) < score(best) ? role : best).id;
    }
    const panels = state.panels.map((panel, i) => {
      if (!targets[i]) return panel;
      const layout = geometry(panel).layout;
      let markers = [];
      let sourceRoles = [];
      if (panel.isColor) {
        sourceRoles = panel.palette.map(E.swatchHex).map(hex => hex === '#ffffff' ? null : importedRole(hex));
      } else if (auto) {
        const model = colorModel.filter(example => roles.some(role => role.id === example.role));
        markers = E.suggestColors(layout, model.length ? model : colorModel.map(example => ({ ...example, role: roles[0].id })));
      }
      return { ...panel, markers, sourceRoles, traced: true };
    });
    state = { ...state, roles, panels };
    const panel = panels[selection.index];
    const initialRole = panel.markers[0]?.role ?? panel.sourceRoles.find(Boolean);
    selection.view = initialRole ? 'compare' : 'ink';
    selection.variant = 'a';
    if (initialRole) selection.role = initialRole;
    render();
    report('下絵から描き始めます。');
    openReplay();
  }

  function savePsd() {
    const panel = state.panels[selection.index];
    const model = geometry(panel);
    const pen = styled(model);
    const assignments = assignedColors(panel, model.layout);
    const colors = palette(selection.variant);
    const roles = state.roles.map(role => ({ ...role, hex: role[selection.variant] }));
    const stack = E.makeLayers(pen, model.layout, assignments, roles);
    const layers = window.KomaPSD(panel, stack, E.paint(pen, model.layout, assignments, colors));
    download(new Blob(layers, { type: 'image/vnd.adobe.photoshop' }), panel.name + '.psd');
    report('ペン、色別 ' + (stack.length - 2) + ' 層、用紙をPSDに保存します。');
  }

  function saveVector(format) {
    const panel = state.panels[selection.index];
    const model = geometry(panel);
    const { width, height } = panel;
    const pen = styled(model);
    // The interchange path uses the visible pen silhouette at half opacity.
    const contours = state.pen === 'original' ? model.contours : E.traceInk(pen, 192);
    if (format === 'svg') {
      const assignments = assignedColors(panel, model.layout);
      const layers = E.makeLayers(pen, model.layout, assignments, state.roles.map(role => ({ ...role, hex: role[selection.variant] })));
      const xml = E.makeSvg(panel, contours, layers);
      download(new Blob([xml], { type: 'image/svg+xml' }), panel.name + '.svg');
    } else {
      const data = { format: 'nazori-coordinates/1', units: 'px', origin: 'top-left', width, height, pen: state.pen,
        strength: state.strength,
        inkContours: contours.map(({ points }) => ({ closed: true, points })),
        replayContours: [...model.contours].sort((a, b) => b.length - a.length)
          .map(({ points, length }) => ({ closed: true, length, points })),
        marks: panel.markers, sourceRoles: panel.sourceRoles, colorGroups: state.roles, separators: panel.barriers };
      download(new Blob([JSON.stringify(data)], { type: 'application/json' }), panel.name + '-coordinates.json');
    }
    report((format === 'svg' ? '色とペンのベクターSVG' : '座標JSON') + 'をダウンロードします。');
  }

  function openReplay() {
    if (replay) closeReplay();
    const panel = state.panels[selection.index];
    const model = geometry(panel);
    const { contours, layout } = model;
    const rebuilt = styled(model);
    const assignments = assignedColors(panel, layout);
    const colors = E.paint(rebuilt, layout, assignments, palette(selection.variant));
    const raw = panel.rgba;
    const inkPixels = rebuilt.ink;
    const { timing, jobs } = paintPlan(layout, assignments, palette(selection.variant));
    const paths = [...contours].sort((a, b) => b.length - a.length);
    const total = paths.reduce((sum, shape) => sum + E.traceWeight(shape.length), 0);
    const distance = paths.reduce((sum, shape) => sum + shape.length, 0);
    const extraTime = Math.min(9000, Math.max(0, (distance - 85000) / 27));
    const inkTimeline = E.inkTimeline(rebuilt, paths, total);
    const image = $('movie');
    image.width = panel.width;
    image.height = panel.height;
    replay = { panel, paths, total, colors, raw, inkPixels, inkTimeline, timing, jobs,
      colorStart: jobs.length ? .67 : .99, duration: (jobs.length ? duration : 11100) + extraTime,
      ctx: image.getContext('2d'), frame: new ImageData(panel.width, panel.height), position: 0, running: false };
    $('view').hidden = true;
    $('replay').hidden = false;
    updateSourceKind();
    drawReplay(0);
    resumeReplay();
  }

  function paintPlan(layout, assignments, colors) {
    const { width, height, labels, regions } = layout;
    const timing = new Float32Array(labels.length).fill(Infinity);
    const jobs = [];
    const byRole = new Map();
    const byRegion = new Int16Array(regions.length + 1).fill(-1);
    for (const region of regions) {
      const role = assignments.get(region.id);
      if (!Object.hasOwn(colors, role)) continue;
      let i = byRole.get(role);
      if (i === undefined) {
        i = jobs.length;
        byRole.set(role, i);
        jobs.push({ ...region, size: 0, samples: [], color: colors[role] });
      }
      const job = jobs[i];
      job.size += region.size;
      job.xMin = Math.min(job.xMin, region.xMin);
      job.yMin = Math.min(job.yMin, region.yMin);
      job.xMax = Math.max(job.xMax, region.xMax);
      job.yMax = Math.max(job.yMax, region.yMax);
      byRegion[region.id] = i;
    }
    const total = jobs.reduce((sum, job) => sum + Math.sqrt(job.size), 0);
    let start = 0;
    for (const job of jobs) {
      job.start = start;
      job.length = Math.sqrt(job.size) / total;
      start += job.length;
    }
    for (let i = 0; i < labels.length; i++) {
      const job = jobs[byRegion[labels[i]]];
      if (!job) continue;
      const x = i % width, y = Math.floor(i / width);
      const xPortion = (x - job.xMin) / Math.max(1, job.xMax - job.xMin);
      const band = Math.min(4, Math.floor((y - job.yMin) * 5 / (job.yMax - job.yMin + 1)));
      const scan = (band + (band % 2 === 0 ? xPortion : 1 - xPortion)) / 5;
      timing[i] = job.start + job.length * scan;
      const step = Math.min(24, Math.floor(25 * scan));
      const targetY = job.yMin + (band + .5) * (job.yMax - job.yMin + 1) / 5;
      if (!job.samples[step] || Math.abs(y - targetY) < Math.abs(job.samples[step][1] - targetY)) {
        job.samples[step] = [x, y, band % 2 ? -1 : 1];
      }
    }
    return { timing, jobs };
  }

  function drawPerimeters(model, progress) {
    const { ctx, paths, panel, total } = model;
    let remaining = progress * total;
    let pointer;
    ctx.beginPath();
    for (const { points, length } of paths) {
      const [x, y] = points[0];
      const weight = E.traceWeight(length);
      let distance = length * Math.min(1, remaining / weight);
      ctx.moveTo(x, y);
      pointer = [x, y, 0];
      for (let j = 0; j < points.length && distance > 0; j++) {
        const [x1, y1] = points[j];
        const [x2, y2] = points[(j + 1) % points.length];
        const segment = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        const part = Math.min(1, distance / segment);
        pointer = [x1 + (x2 - x1) * part, y1 + (y2 - y1) * part, Math.atan2(y2 - y1, x2 - x1)];
        ctx.lineTo(pointer[0], pointer[1]);
        distance -= segment;
      }
      remaining -= weight;
      if (remaining <= 0) break;
    }
    ctx.strokeStyle = '#8e4777';
    ctx.lineWidth = Math.max(1, panel.width / 430);
    ctx.stroke();
    return pointer;
  }

  function drawPointer(ctx, panel, [x, y, heading], color, brush) {
    const unit = Math.max(.85, Math.min(panel.width, panel.height) / 450);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(x > panel.width - 56 * unit ? -1 : 1, y < 50 * unit ? -1 : 1);
    ctx.rotate(-.69 + Math.sin(heading) * .28);
    ctx.scale(unit, unit);
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    if (brush) {
      ctx.rotate(heading < 0 ? .4 : 0);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#352137';
      const tuft = new Path2D('M0 0 Q5 -8 12 -7 L17 -4 L12 0 Q7 5 0 0 Z');
      ctx.fill(tuft);
      ctx.stroke(tuft);
      ctx.fillStyle = '#f0b275';
      ctx.strokeStyle = '#5f375b';
      const handle = new Path2D('M14 -7 L45 -6 Q51 -4 45 0 L14 1 Z');
      ctx.fill(handle);
      ctx.stroke(handle);
    } else {
      const head = new Path2D('M0 0 L9 -11 L18 -9 L18 1 L9 4 Z');
      const body = new Path2D('M17 -9 L48 -10 Q54 -8 54 -4 Q54 1 48 2 L17 1 Z');
      ctx.fillStyle = '#fff5d6';
      ctx.strokeStyle = '#4f2a4b';
      ctx.fill(head);
      ctx.stroke(head);
      ctx.fillStyle = '#5e3364';
      ctx.fill(body);
      ctx.stroke(body);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(12, -4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawReplay(t, model = replay) {
    const { ctx, panel, frame, raw, inkPixels, inkTimeline, colors, timing, jobs, colorStart } = model;
    const visible = model === replay;
    model.position = t;
    if (visible) $('scrub').value = Math.round(t * 1000);
    const contourEnd = colorStart * .95;
    if (t < colorStart) {
      const progress = t / contourEnd;
      const guide = Math.max(0, (.19 * (1 - progress)) * 1.1);
      if (visible) $('phase').textContent = 'ペンでトレス';
      const d = frame.data;
      for (let i = 0; i < d.length; i += 4) {
        const k = i / 4;
        const opacity = Math.min(1, Math.max(0, (progress - inkTimeline[k]) / .019));
        const inkFactor = 1 - (1 - inkPixels[k] / 255) * opacity;
        for (let channel = 0; channel < 3; channel++) {
          d[i + channel] = (255 - (255 - raw[i + channel]) * guide * raw[i + 3] / 255) * inkFactor;
        }
        d[i + 3] = 255;
      }
      ctx.putImageData(frame, 0, 0);
      if (progress < 1) {
        ctx.globalAlpha = .56;
        const pointer = drawPerimeters(model, progress);
        ctx.globalAlpha = 1;
        if (pointer) drawPointer(ctx, panel, pointer, '#2e2338', false);
      }
      return;
    }
    if (visible) $('phase').textContent = t === 1 ? '仕上がり' : '彩色';
    const colorTime = (t - colorStart) / (1 - colorStart);
    const d = frame.data;
    for (let i = 0; i < timing.length; i++) {
      const k = i * 4;
      const alpha = t === 1 ? 1 : Math.min(1, Math.max(0, (colorTime - timing[i]) / .018));
      const base = inkPixels[i];
      d[k] = base + (colors[k] - base) * alpha;
      d[k + 1] = base + (colors[k + 1] - base) * alpha;
      d[k + 2] = base + (colors[k + 2] - base) * alpha;
      d[k + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
    const active = t < 1 && jobs.find(job => colorTime >= job.start && colorTime < job.start + job.length);
    if (active) {
      let index = Math.min(24, Math.floor(25 * (colorTime - active.start) / active.length));
      while (index >= 0 && !active.samples[index]) index--;
      const sample = index >= 0 ? active.samples[index] : active.samples.find(Boolean);
      if (sample) drawPointer(ctx, panel, sample, active.color, true);
    }
  }

  function resumeReplay() {
    if (replay.position === 1) drawReplay(0);
    const model = replay;
    model.running = true;
    const cycle = model.duration / (multiplier('draw-speed') * multiplier('speed'));
    const start = performance.now() - model.position * cycle;
    $('play').textContent = '▶ はじめから再生';
    $('replay-toggle').textContent = '一時停止';
    function tick(now) {
      if (replay !== model || !model.running) return;
      const t = Math.min(1, (now - start) / cycle);
      drawReplay(t);
      if (t === 1) {
        pauseReplay();
        report('工程の再生が終わりました。');
      }
      else model.raf = requestAnimationFrame(tick);
    }
    model.raf = requestAnimationFrame(tick);
  }

  function pauseReplay() {
    if (!replay) return;
    cancelAnimationFrame(replay.raf);
    replay.running = false;
    $('replay-toggle').textContent = replay.position === 1 ? '↶ 巻き戻す' : replay.position === 0 ? '再生' : '再開';
    $('play').textContent = replay.position === 1 ? '↶ 巻き戻す' : '▶ はじめから再生';
    updateSourceKind();
  }

  function closeReplay() {
    pauseReplay();
    replay = null;
    $('replay').hidden = true;
    $('view').hidden = false;
    $('play').textContent = '▶ 工程を再生';
    if (state) updateSourceKind();
  }

  function saveVideo() {
    if (!replay || recording) return;
    const format = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(type => window.MediaRecorder?.isTypeSupported(type));
    if (!format || !$('movie').captureStream) return report('このブラウザーはWebMの保存に対応していません。');
    pauseReplay();
    const { panel } = replay;
    const movie = canvas(panel.width, panel.height);
    const model = { ...replay, ctx: movie.getContext('2d'), frame: new ImageData(panel.width, panel.height) };
    const videoDuration = model.duration / multiplier('draw-speed');
    const stream = movie.captureStream(30);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 3500000 });
    } catch {
      stream.getTracks().forEach(track => track.stop());
      return report('この画像サイズでは動画を保存できません。');
    }
    recording = true;
    $('save-video').disabled = true;
    $('save-video').textContent = '動画を作成中';
    const chunks = [];
    let failed = false;
    let frameId;
    function finish() {
      if (!recording) return;
      recording = false;
      cancelAnimationFrame(frameId);
      stream.getTracks().forEach(track => track.stop());
      $('save-video').disabled = false;
      $('save-video').textContent = '動画を保存';
      if (failed || !chunks.length) return report('動画を作成できませんでした。');
      download(new Blob(chunks, { type: 'video/webm' }), panel.name + '-工程.webm');
      report('工程動画のダウンロードを開始しました。');
    }
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { failed = true; finish(); };
    recorder.onstop = finish;
    try {
      recorder.start();
    } catch {
      failed = true;
      finish();
      return;
    }
    const start = performance.now();
    function tick(now) {
      if (!recording) return;
      drawReplay(Math.min(1, (now - start) / videoDuration), model);
      if (now - start > videoDuration + 320) recorder.stop();
      else frameId = requestAnimationFrame(tick);
    }
    frameId = requestAnimationFrame(tick);
  }

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    closeReplay();
    selection.view = button.dataset.view;
    splitStart = null;
    render(false);
  }));
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
    closeReplay();
    selection.tool = button.dataset.tool;
    if (selection.view === 'ink') selection.view = 'compare';
    splitStart = null;
    render(false);
  }));
  function rewind() {
    pauseReplay();
    drawReplay(0);
    pauseReplay();
  }
  $('play').onclick = () => {
    if (!state.panels[selection.index].traced) return tracePanels();
    if (replay?.position === 1) rewind(); else openReplay();
  };
  $('replay-close').onclick = closeReplay;
  function multiplier(id) { return Number($(id).value) / 100; }
  function restoreSpeeds(preferences = {}) {
    for (const [id, name] of [['draw-speed', 'drawSpeed'], ['speed', 'playbackSpeed']]) {
      const value = preferences?.[name];
      $(id).value = Number.isInteger(value) && value >= 25 && value <= 250 ? value : 100;
      $(id + '-value').textContent = multiplier(id) + '倍';
    }
  }
  for (const id of ['draw-speed', 'speed']) $(id).oninput = () => {
    $(id + '-value').textContent = multiplier(id) + '倍';
    if (replay?.running) {
      pauseReplay();
      resumeReplay();
    }
  };
  $('save-video').onclick = saveVideo;
  $('replay-toggle').onclick = () => replay.running ? pauseReplay() : replay.position === 1 ? rewind() : resumeReplay();
  $('scrub').oninput = event => {
    pauseReplay();
    drawReplay(Number(event.target.value) / 1000);
    pauseReplay();
  };
  $('undo').onclick = () => {
    const prior = history.pop();
    if (!prior) return;
    future.push({ state, selection: { ...selection } });
    closeReplay();
    ({ state, selection } = prior);
    splitStart = null;
    render();
    report('前の編集に戻しました。');
  };
  $('redo').onclick = () => {
    const next = future.pop();
    if (!next) return;
    history.push({ state, selection: { ...selection } });
    closeReplay();
    ({ state, selection } = next);
    splitStart = null;
    render();
    report('取り消した編集をやり直しました。');
  };
  $('reset-demo').onclick = async () => {
    if (history.length && !window.confirm('今の編集を閉じて、作例に戻りますか？')) return;
    closeReplay();
    try {
      await startDemo();
      report('トレス前の作例を開きました。');
    } catch { demoFailed(); }
  };
  $('highlight').onchange = () => render(false);
  $('pen').onchange = event => {
    remember();
    closeReplay();
    state = { ...state, pen: event.target.value };
    selection.view = 'ink';
    render(false);
    report('ペンタッチを変更しました。');
  };
  $('strength').oninput = event => { $('strength-value').textContent = event.target.value + '%'; };
  $('strength').onchange = event => {
    remember();
    closeReplay();
    state = { ...state, strength: Number(event.target.value) };
    selection.view = 'ink';
    render(false);
  };
  for (const variant of ['a', 'b']) $('quick-' + variant).onclick = () => {
    closeReplay();
    selection.variant = variant;
    render(false);
  };
  $('trace').onclick = tracePanels;
  $('psd').onclick = savePsd;
  $('svg').onclick = () => saveVector('svg');
  $('coordinates').onclick = () => saveVector('json');
  $('threshold').oninput = event => { $('threshold-value').textContent = event.target.value; };
  $('threshold').onchange = event => {
    remember();
    closeReplay();
    splitStart = null;
    state = { ...state, threshold: Number(event.target.value) };
    render(false);
  };
  $('add-role').onclick = () => {
    $('role-form').hidden = !$('role-form').hidden;
    if (!$('role-form').hidden) $('role-name').focus();
  };
  $('role-form').onsubmit = event => {
    event.preventDefault();
    const name = $('role-name').value.trim();
    if (!name || state.roles.some(role => role.name === name)) return report('既存の色グループと異なる名前を入力してください。');
    if (state.roles.length >= roleLimit) return report('色グループは' + roleLimit + '件までです。');
    remember();
    const id = 'color-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    state = { ...state, roles: [...state.roles, { id, name, a: '#c58070', b: '#8275bc' }] };
    selection.role = id;
    selection.tool = 'paint';
    splitStart = null;
    $('role-form').hidden = true;
    $('role-name').value = '';
    render();
    report('色グループを追加しました。');
  };
  $('save-project').onclick = saveProject;
  $('jump-export').onclick = () => $('export-heading').focus();
  $('open-project').onclick = () => $('project').click();
  $('project').onchange = () => readFiles($('project'), async ([file]) => {
    const project = await readProject(file);
    remember();
    closeReplay();
    state = project;
    const preferences = state.preferences;
    const index = coordinate(preferences?.index, state.panels.length) ? preferences.index : 0;
    const role = state.roles.some(item => item.id === preferences?.role) ? preferences.role : state.roles[0].id;
    selection = { index, role, variant: preferences?.variant === 'b' ? 'b' : 'a', view: 'compare', tool: 'paint' };
    restoreSpeeds(preferences);
    splitStart = null;
    render();
    report(project.panels.length + '枚のプロジェクトを開きました。');
  });
  $('import').onclick = () => $('images').click();
  $('replace').onclick = () => $('replacement').click();
  $('replacement').onchange = () => {
    const index = selection.index;
    const original = state.panels[index];
    return readFiles($('replacement'), async ([file]) => {
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '原稿';
      const image = await bitmapToInk(file);
      if (state.panels[index] !== original) return report('原稿が切り替わりました。差し替える画像をもう一度選んでください。');
      closeReplay();
      splitStart = null;
      selection.view = 'compare';
      selection.index = index;
      modifyPanel(index, () => ({ name, ...image, markers: [], barriers: [], traced: false }));
      state = { ...state, demo: false };
      report('原稿を差し替えました。ペンと描画設定を引き継いでいます。');
    });
  };
  $('images').onchange = () => readFiles($('images'), async files => {
    const isDemo = state.demo;
    const current = isDemo ? [] : state.panels;
    if (current.length + files.length > limit) throw new Error('1プロジェクトに読み込める線画は8枚までです。');
    const panels = [];
    for (const file of files) {
      panels.push({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || '原稿',
        ...await bitmapToInk(file), markers: [], barriers: [], traced: false });
    }
    remember();
    closeReplay();
    splitStart = null;
    state = { ...state, name: isDemo ? '新しい原稿' : state.name, demo: false, panels: [...current, ...panels] };
    selection.index = current.length;
    selection.view = 'compare';
    render();
    report(panels.length + '枚を読み込みました。「トレスする」で処理を開始します。');
  });
  $('export').onclick = () => {
    const panel = state.panels[selection.index];
    const type = $('export-type').value;
    output(panel, type).toBlob(blob => {
      if (!blob) return report('PNGを作成できませんでした。');
      download(blob, panel.name + '-' + type + '.png');
      report('PNGのダウンロードを開始しました。');
    }, 'image/png');
  };
  $('export-type').onchange = () => { $('export').disabled = !state.panels[selection.index].traced && $('export-type').value !== 'source'; };
  const surfaces = [...document.querySelectorAll('header, main')];
  surfaces.forEach(element => { element.inert = true; });
  startDemo().catch(demoFailed).finally(() => surfaces.forEach(element => { element.inert = false; }));
})();
