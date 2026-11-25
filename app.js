(() => {
  'use strict';
  const E = window.KomaEngine;
  const raster = window.NazoriRaster;
  const $ = id => document.getElementById(id);
  const limit = 8;
  const roleLimit = 300;
  const duration = 16700;
  const styles = ['g', 'fine', 'brush', 'original'];
  const quick = ['#f6bfad', '#f8ce78', '#a4ba86', '#528d98', '#797aba', '#ad6798', '#423752', '#fffafa'];
  const exportLabels = { source: '元絵', ink: '線画', a: '配色 A', b: '配色 B' };
  let state;
  let history = [];
  let future = [];
  let selection = { index: 0, role: null, variant: 'a', view: 'ink' };
  let replay = null;
  let busy = false;
  let recording = false;
  let exportSelection;
  let savingExport = false;
  let savingProject = false;
  let colorEdit;
  let palettePanel;
  const colorChannels = [...document.querySelectorAll('[data-color-channel]')];
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
    const sourceList = [['詳細カラー · 凧職人', 'examples/detailed-color.png'],
      ['詳細モノクロ · 時計職人', 'examples/detailed-mono.png'],
      ['モノクロ · 海風の配達員', 'examples/mono.png'],
      ['カラー · 港町の配達員', 'examples/color.png']];
    const panels = await Promise.all(sourceList.map(async ([name, src]) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const sample = canvas(image.naturalWidth, image.naturalHeight);
      sample.getContext('2d').drawImage(image, 0, 0);
      return { ...readInk(sample), name, markers: [], barriers: [], traced: false };
    }));
    state = { name: '付属作例', threshold: 180, pen: 'g', strength: 100, demo: true,
      roles: [], panels };
    selection = { index: 0, role: null, variant: 'a', view: 'ink' };
    history = [];
    future = [];
    restoreSpeeds();
    render();
  }

  function demoFailed() {
    if (state) return report('作例を読み取れませんでした。');
    const blank = canvas(360, 410);
    blank.getContext('2d').fillStyle = '#fff';
    blank.getContext('2d').fillRect(0, 0, 360, 410);
    state = { name: '読み込む原稿を選んでください', threshold: 180, pen: 'g', strength: 100, demo: true,
      roles: [], panels: [{ ...readInk(blank), name: '原稿', markers: [], barriers: [], traced: false }] };
    render();
    report('作例はローカルサーバーで開くと利用できます。「画像を取り込む」から画像を開けます。');
  }

  function remember() {
    history.push({ state, selection: { ...selection } });
    if (history.length > 35) history.shift();
    future = [];
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

  function roleIds(panel) {
    return new Set([...(panel.sourceRoles ?? []), ...panel.markers.map(mark => mark.role)]);
  }

  function panelRoles(panel) {
    const ids = roleIds(panel);
    return state.roles.filter(role => ids.has(role.id));
  }

  function referencedRoles(panels) {
    const ids = new Set(panels.flatMap(panel => [...roleIds(panel)]));
    return state.roles.filter(role => ids.has(role.id));
  }

  function palette(panel, variant) {
    return Object.fromEntries(panelRoles(panel).filter(role => !role.hidden).map(role => [role.id, role[variant]]));
  }

  function assignedColors(panel, layout) {
    return E.resolveColors(layout, panel.markers, panel.sourceRoles);
  }

  function pixels(ctx, panel, data) {
    ctx.putImageData(new ImageData(data, panel.width, panel.height), 0, 0);
  }

  function output(panel, mode, showHighlight = false) {
    const result = canvas(panel.width, panel.height);
    const ctx = result.getContext('2d');
    if (mode === 'source' || !panel.traced) {
      pixels(ctx, panel, panel.rgba);
      return result;
    }
    const model = geometry(panel);
    const assignments = assignedColors(panel, model.layout);
    const colors = mode === 'ink' ? {} : palette(panel, mode);
    const highlight = showHighlight && $('palette-settings').open && $('highlight').checked ? selection.role : undefined;
    pixels(ctx, panel, E.paint(styled(model), model.layout, assignments, colors, { highlight }));
    return result;
  }

  function figure(index, mode, title, caption) {
    const panel = state.panels[index];
    const coloredView = panel.traced && (mode === 'a' || mode === 'b');
    const image = output(panel, mode, coloredView);
    image.setAttribute('aria-label', panel.name + ' ' + title);
    const fig = document.createElement('figure');
    fig.className = 'art';
    fig.dataset.variant = mode;
    const text = document.createElement('figcaption');
    const name = document.createElement('span');
    const extra = document.createElement('small');
    name.textContent = title;
    extra.textContent = caption;
    if (!panel.traced) extra.className = 'pending-trace';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'art-save';
    save.textContent = '保存…';
    save.setAttribute('aria-label', exportLabels[mode] + 'を保存');
    save.onclick = () => openExport(panel, mode, save);
    text.append(name, extra, save);
    fig.append(text, image);
    return fig;
  }

  function drawViews() {
    const { index, variant, view } = selection;
    $('view').classList.toggle('work-grid', view === 'works');
    if (view === 'works') {
      $('view').replaceChildren(...state.panels.map((panel, i) => workCard(panel, i, variant)));
    } else if (!state.panels[index].traced) {
      $('view').replaceChildren(figure(index, 'source', state.demo ? '元絵' : '取り込んだ原稿', 'トレス前'));
    } else if (view === 'ink') {
      const model = geometry(state.panels[index]);
      $('view').replaceChildren(figure(index, 'source', '元絵', state.panels[index].isColor ? 'カラー' : 'モノクロ'),
        figure(index, 'ink', '線画', model.contours.length + ' 個の閉境界'));
    } else if (view === 'result') {
      $('view').replaceChildren(figure(index, 'source', '元絵', state.panels[index].isColor ? 'カラー' : 'モノクロ'),
        figure(index, variant, 'トレス結果', exportLabels[variant]));
    } else {
      $('view').replaceChildren(figure(index, 'a', '配色 A', ''),
        figure(index, 'b', '配色 B', ''));
    }
  }

  function workCard(panel, index, variant) {
    const card = document.createElement('article');
    card.className = 'work-card';
    const name = document.createElement('h2');
    name.textContent = panel.name;
    const previews = document.createElement('div');
    previews.className = 'work-previews';
    const resultMode = panel.traced ? (panelHasColor(panel) ? variant : 'ink') : null;
    for (const [title, mode] of [['元絵', 'source'], ['作業後', resultMode]]) {
      const preview = document.createElement(mode ? 'button' : 'div');
      preview.className = 'work-preview';
      const label = document.createElement('span');
      label.textContent = title;
      preview.append(label);
      if (mode) {
        preview.type = 'button';
        preview.setAttribute('aria-label', panel.name + 'の' + title + 'を表示');
        preview.onclick = () => openExport(panel, mode, preview);
        const image = document.createElement('img');
        image.alt = '';
        image.src = thumbnail(panel, mode, 280, 300);
        preview.append(image);
        if (title === '作業後') {
          const caption = document.createElement('small');
          caption.textContent = exportLabels[mode];
          preview.append(caption);
        }
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'work-preview-empty';
        placeholder.textContent = 'トレス前';
        preview.append(placeholder);
      }
      previews.append(preview);
    }
    const edit = document.createElement('button');
    edit.className = 'work-edit';
    edit.type = 'button';
    edit.textContent = '作業画面で開く';
    edit.setAttribute('aria-label', panel.name + 'を作業画面で開く');
    edit.onclick = () => {
      if (selection.index !== index) selection.variant = 'a';
      selection.index = index;
      selection.view = defaultWorkView(panel);
      render();
      $('work-screen').focus();
    };
    card.append(name, previews, edit);
    return card;
  }

  function defaultWorkView(panel) {
    return panel.traced && panel.isColor ? 'result' : 'ink';
  }

  function thumbnail(panel, variant, width, height) {
    const thumb = canvas(width, height);
    const ctx = thumb.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const fit = Math.min(width / panel.width, height / panel.height);
    const w = panel.width * fit, h = panel.height * fit;
    ctx.drawImage(output(panel, variant), (width - w) / 2, (height - h) / 2, w, h);
    return thumb.toDataURL();
  }

  function panelHasColor(panel) {
    return panel.sourceRoles?.some(Boolean) || panel.markers.some(marker => marker.role);
  }

  function renderRoles() {
    const panel = state.panels[selection.index];
    const usage = panel.traced ? assignedColors(panel, geometry(panel).layout) : new Map();
    const used = new Set(usage.values());
    const roles = panelRoles(panel).sort((a, b) => Number(used.has(b.id)) - Number(used.has(a.id)));
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
        render();
        [...list.children].find(child => child.dataset.role === role.id)?.firstElementChild.focus({ preventScroll: true });
      });
      row.append(name);
      for (const variant of ['a', 'b']) {
        const picker = document.createElement('button');
        picker.type = 'button';
        picker.className = 'layer-color';
        picker.dataset.colorVariant = variant;
        picker.setAttribute('aria-label', role.name + ' 配色 ' + variant.toUpperCase());
        const chip = document.createElement('span');
        chip.style.backgroundColor = role[variant];
        picker.append(chip);
        picker.onclick = () => openColorEditor(role, variant);
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
    report('配色 ' + variant.toUpperCase() + ' の色を更新しました。');
  }

  function setColorPreview(hex) {
    $('color-preview').style.backgroundColor = hex;
    colorChannels.forEach((control, index) => { control.value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16); });
  }

  function openColorEditor(role, variant) {
    colorEdit = { id: role.id, variant };
    const hex = role[variant];
    $('color-target').textContent = role.name + ' · 配色 ' + variant.toUpperCase();
    $('color-original').style.backgroundColor = hex;
    $('color-hex').value = hex;
    setColorPreview(hex);
    $('color-dialog').showModal();
  }

  $('color-hex').oninput = event => {
    const hex = '#' + event.target.value.replace(/^#/, '');
    if (colorPattern.test(hex)) setColorPreview(hex);
  };
  for (const channel of colorChannels) channel.oninput = () => {
    const hex = '#' + colorChannels.map(control => Number(control.value).toString(16).padStart(2, '0')).join('');
    $('color-hex').value = hex;
    $('color-preview').style.backgroundColor = hex;
  };
  $('color-cancel').onclick = () => $('color-dialog').close();
  $('color-form').onsubmit = event => {
    event.preventDefault();
    const { id, variant } = colorEdit;
    const hex = '#' + $('color-hex').value.replace(/^#/, '').toLowerCase();
    $('color-dialog').close();
    recolor(id, variant, hex, true);
    const row = [...$('roles').children].find(element => element.dataset.role === id);
    row?.querySelector('[data-color-variant="' + variant + '"]')?.focus({ preventScroll: true });
  };

  function renderQuick() {
    for (const variant of ['a', 'b']) $('quick-' + variant).setAttribute('aria-pressed', String(selection.variant === variant));
    const role = state.roles.find(item => item.id === selection.role);
    $('quick-colors').previousElementSibling.hidden = !role;
    $('quick-colors').hidden = !role;
    if (!role) return;
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

  function showsPalette() {
    const panel = state.panels[selection.index];
    return panel.traced && (panel.isColor || panelHasColor(panel)) && ['compare', 'result'].includes(selection.view);
  }

  function renderScreen() {
    const gallery = selection.view === 'works';
    const preview = Boolean(exportSelection);
    $('screen-heading').textContent = preview ? '画像プレビュー' : gallery ? '画像一覧' : '作業画面';
    $('work-screen').setAttribute('aria-pressed', String(!gallery));
    $('image-screen').setAttribute('aria-pressed', String(gallery));
    document.querySelector('main').classList.toggle('single-screen', gallery || preview);
    document.querySelector('.inspector').hidden = gallery || preview;
    $('gallery-hint').hidden = !gallery || preview;
    $('work-controls').hidden = gallery || preview;
    $('view').hidden = preview || Boolean(replay);
    $('export-page').hidden = !preview;
    $('palette-settings').hidden = !showsPalette() || Boolean(replay);
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
    if (palettePanel !== panel) {
      $('palette-settings').open = false;
      $('highlight').checked = false;
      palettePanel = panel;
    }
    const roles = panelRoles(panel);
    if (!roles.some(role => role.id === selection.role)) selection.role = roles[0]?.id ?? null;
    if (exportSelection && !state.panels.includes(exportSelection.panel)) clearExport();
    renderScreen();
    $('active-panel-name').textContent = panel.name;
    $('work-views').hidden = !panel.traced;
    $('result-view').hidden = !panel.isColor && !panelHasColor(panel);
    $('play').hidden = !panel.traced;
    updateSourceKind();
    for (const el of document.querySelectorAll('[data-view]')) el.setAttribute('aria-pressed', String(el.dataset.view === selection.view));
    if (showsPalette()) {
      if (refreshRoles) renderRoles();
      renderQuick();
    }
    drawViews();
  }

  function report(message) {
    $('status').textContent = message;
  }

  function setImportFeedback(kind = '', message = '') {
    const feedback = $('import-feedback');
    feedback.dataset.state = kind;
    $('import-progress').hidden = kind !== 'busy';
    $('import-message').textContent = message;
    feedback.hidden = !message;
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

  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64Image(encoded, type) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function saveProject() {
    if (savingProject || savingExport) return;
    savingProject = true;
    $('save-project').disabled = true;
    const data = {
      format: 'koma-iro/1', name: state.name, threshold: state.threshold, pen: state.pen, strength: state.strength, roles: state.roles,
      preferences: { index: selection.index, variant: selection.variant, role: selection.role,
        drawSpeed: Number($('draw-speed').value), playbackSpeed: Number($('speed').value) },
    };
    const panels = state.panels;
    try {
      data.panels = [];
      let sourceBytes = 0;
      for (const panel of panels) {
        const { name, markers, sourceRoles, barriers, traced, originalFile, originalWidth, originalHeight } = panel;
        const record = { name, markers, sourceRoles, barriers, traced, source: output(panel, 'source').toDataURL('image/png') };
        if (originalWidth) {
          record.originalWidth = originalWidth;
          record.originalHeight = originalHeight;
        }
        sourceBytes += record.source.length + (originalFile ? Math.ceil(originalFile.size / 3) * 4 : 0);
        if (sourceBytes > projectLimit) throw new Error('プロジェクトが85 MBを超えています。原稿を分けて保存してください。');
        if (originalFile) record.original = await blobDataUrl(originalFile);
        data.panels.push(record);
      }
      const file = new Blob([JSON.stringify(data)], { type: 'application/json' });
      if (file.size > projectLimit) throw new Error('プロジェクトが85 MBを超えています。原稿を分けて保存してください。');
      download(file, 'koma-iro-project.json');
      report('プロジェクトのダウンロードを開始しました。');
    } catch (error) {
      report(error.message || 'プロジェクトを保存できませんでした。');
    } finally {
      savingProject = false;
      $('save-project').disabled = false;
    }
  }

  const projectLimit = 85 * 1024 * 1024;
  const colorPattern = /^#[0-9a-f]{6}$/i;
  const rolePattern = /^(?!constructor$|prototype$|__proto__$)[a-z][a-z0-9-]{0,45}$/;
  const title = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
  const coordinate = (n, size) => Number.isInteger(n) && n >= 0 && n < size;

  async function bitmapToInk(file) {
    await raster.inspectFile(file);
    const bitmap = await createImageBitmap(file);
    try {
      const { width: originalWidth, height: originalHeight } = bitmap;
      raster.checkInputSize(originalWidth, originalHeight);
      const { width, height } = raster.previewSize(originalWidth, originalHeight);
      const image = canvas(width, height);
      image.getContext('2d').drawImage(bitmap, 0, 0, image.width, image.height);
      const drawing = readInk(image);
      if (width === originalWidth && height === originalHeight) return drawing;
      return { ...drawing, originalWidth, originalHeight,
        originalFile: raster.canExportOriginal(originalWidth, originalHeight) ? file : null };
    } finally {
      bitmap.close();
    }
  }

  async function readProject(file) {
    if (file.size > projectLimit) throw new Error('プロジェクトは85 MBまでです。');
    const data = JSON.parse(await file.text());
    if (!data || data.format !== 'koma-iro/1' || !title(data.name, 120)
        || !Number.isInteger(data.threshold) || data.threshold < 32 || data.threshold > 248
        || !Array.isArray(data.roles) || data.roles.length > roleLimit
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
      const drawing = await bitmapToInk(base64Image(panel.source.split(',')[1], 'image/png'));
      const { width, height } = drawing;
      if (panel.original !== undefined || panel.originalWidth !== undefined || panel.originalHeight !== undefined) {
        const { original, originalWidth, originalHeight } = panel;
        raster.checkInputSize(originalWidth, originalHeight);
        const preview = raster.previewSize(originalWidth, originalHeight);
        if (preview.width !== width || preview.height !== height)
          throw new Error('プロジェクトの原本とプレビューの寸法が一致しません。');
        drawing.originalWidth = originalWidth;
        drawing.originalHeight = originalHeight;
        if (original !== undefined) {
          const match = typeof original === 'string' && original.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
          if (!match || match[2].length > Math.ceil(raster.fileLimit / 3) * 4
              || !raster.canExportOriginal(originalWidth, originalHeight))
            throw new Error('プロジェクトの原本データが壊れています。');
          const blob = base64Image(match[2], match[1]);
          const size = await raster.inspectFile(blob);
          const same = size.width === originalWidth && size.height === originalHeight;
          const rotated = size.width === originalHeight && size.height === originalWidth;
          if (!same && !rotated) throw new Error('プロジェクトの原本の寸法が一致しません。');
          drawing.originalFile = blob;
        }
      }
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
    if (!files.length || busy || savingExport || savingProject) return;
    const importing = input === $('images');
    busy = true;
    $('import').disabled = $('open-project').disabled = true;
    if (importing) setImportFeedback('busy', '画像を読み込み中…');
    try {
      await action(files);
    } catch (error) {
      const message = error instanceof SyntaxError ? 'JSONを読み取れませんでした。'
        : importing && error instanceof DOMException ? '画像を開けませんでした。'
          : error.message || 'ファイルを読み取れませんでした。';
      if (importing) setImportFeedback('error', message);
      report(message);
    } finally {
      busy = false;
      $('import').disabled = $('open-project').disabled = false;
    }
  }

  function tracePanels() {
    if (busy) return;
    closeReplay();
    const index = selection.index;
    const active = state.panels[index];
    if (active.traced && panelHasColor(active)
      && !window.confirm('この原稿の色を元絵から取り直しますか？')) return;
    setImportFeedback();
    const panel = { ...active, markers: [], sourceRoles: [], traced: true };
    const panels = state.panels.map((item, i) => i === index ? panel : item);
    const roles = referencedRoles(panels);
    if (panel.isColor) {
      const colors = panel.palette.map(E.swatchHex);
      if (roles.length + colors.filter(hex => hex !== '#ffffff').length > roleLimit) {
        return report('このプロジェクトで扱える色レイヤー数を超えました。');
      }
      const prefix = 'c-' + crypto.randomUUID().replaceAll('-', '') + '-';
      panel.sourceRoles = colors.map((hex, i) => {
        if (hex === '#ffffff') return null;
        const id = prefix + i;
        roles.push({ id, name: '原稿色 ' + hex, a: hex, b: hex });
        return id;
      });
    }
    remember();
    state = { ...state, roles, panels };
    selection.view = defaultWorkView(panel);
    selection.variant = 'a';
    selection.role = panel.sourceRoles.find(Boolean) ?? null;
    render();
    report('下絵から描き始めます。');
    openReplay({ returnToComparison: true });
  }

  function openExport(panel, mode, opener) {
    exportSelection = { panel, mode, opener };
    const image = output(panel, mode);
    image.setAttribute('aria-label', panel.name + ' ' + exportLabels[mode]);
    $('export-image').replaceChildren(image);
    $('export-target').textContent = panel.name;
    $('export-heading').textContent = exportLabels[mode];
    $('close-export').textContent = selection.view === 'works' ? '← 画像一覧に戻る' : '← 作業画面に戻る';
    const formats = mode === 'source' ? ['png']
      : mode === 'ink' && panelHasColor(panel) ? ['png', 'svg']
        : ['png', 'psd', 'svg', 'json'];
    const field = $('export-type');
    for (const option of field.options) {
      option.hidden = option.disabled = !formats.includes(option.value);
    }
    field.value = 'png';
    const sizeField = $('export-size');
    sizeField.replaceChildren();
    $('export-size-control').hidden = !panel.originalFile;
    if (panel.originalFile) {
      sizeField.add(new Option('元寸 ' + dimensions(panel.originalWidth, panel.originalHeight), 'original'));
      sizeField.add(new Option('プレビュー寸法 ' + dimensions(panel.width, panel.height), 'preview'));
    }
    $('export-size-note').textContent = panel.originalFile
      ? '画面は ' + dimensions(panel.width, panel.height) + ' のプレビューです。元寸を選ぶと保存時に原本から処理します。'
      : panel.originalWidth ? '原稿は元寸保存の上限（1,600万画素）を超えています。保存寸法は '
        + dimensions(panel.width, panel.height) + ' です。'
        : '保存寸法は ' + dimensions(panel.width, panel.height) + ' です。';
    $('export-help').textContent = mode === 'source' ? '元絵は PNG で保存できます。'
      : formats.length === 2 ? '色レイヤー付きの PSD と座標 JSON は、配色 A または B の画像から保存できます。' : '';
    $('export-status').textContent = '';
    renderScreen();
    $('export-heading').focus();
  }

  function dimensions(width, height) {
    return width + ' × ' + height + ' px';
  }

  function originalExport(panel, mode, type) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('export-worker.js');
      const finish = (callback, value) => {
        clearTimeout(timeout);
        worker.terminate();
        callback(value);
      };
      const timeout = setTimeout(() => finish(reject, new Error('元寸保存が時間内に終わりませんでした。プレビュー寸法で保存できます。')), 120000);
      worker.onmessage = ({ data }) => data.blob
        ? finish(resolve, data.blob)
        : finish(reject, new Error(data.error || '元寸で保存できませんでした。'));
      worker.onerror = () => finish(reject, new Error('元寸で保存できませんでした。プレビュー寸法で保存できます。'));
      worker.onmessageerror = worker.onerror;
      try {
        const { width, height, markers, barriers, sourceRoles, palette: sourcePalette,
          originalFile, originalWidth, originalHeight } = panel;
        worker.postMessage({ file: originalFile, originalWidth, originalHeight,
          panel: { width, height, markers, barriers, sourceRoles, palette: sourcePalette },
          roles: panelRoles(panel), threshold: state.threshold, pen: state.pen, strength: state.strength, mode, type });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function clearExport() {
    exportSelection = null;
    $('export-image').replaceChildren();
  }

  function closeExport() {
    const opener = exportSelection?.opener;
    clearExport();
    render();
    if (!opener) return;
    // Re-rendered canvases and thumbnails replace the old controls.
    const label = opener.getAttribute('aria-label');
    [...$('view').querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label)?.focus();
  }

  function savePsd(panel, mode) {
    const model = geometry(panel);
    const pen = styled(model);
    const assignments = assignedColors(panel, model.layout);
    const colors = mode === 'ink' ? {} : palette(panel, mode);
    const roles = mode === 'ink' ? [] : panelRoles(panel).map(role => ({ ...role, hex: role[mode] }));
    const stack = E.makeLayers(pen, model.layout, assignments, roles);
    const layers = window.KomaPSD(panel, stack, E.paint(pen, model.layout, assignments, colors));
    downloadExport(new Blob(layers, { type: 'image/vnd.adobe.photoshop' }), panel.name + (mode === 'b' ? '-b' : '') + '.psd');
  }

  function saveVector(format, panel, mode) {
    const model = geometry(panel);
    const { width, height } = panel;
    const pen = styled(model);
    // The interchange path uses the visible pen silhouette at half opacity.
    const contours = state.pen === 'original' ? model.contours : E.traceInk(pen, 192);
    if (format === 'svg') {
      const assignments = assignedColors(panel, model.layout);
      const roles = mode === 'ink' ? [] : panelRoles(panel).map(role => ({ ...role, hex: role[mode] }));
      const layers = E.makeLayers(pen, model.layout, assignments, roles);
      const xml = E.makeSvg(panel, contours, layers);
      const suffix = mode === 'b' ? '-b' : mode === 'ink' && panelHasColor(panel) ? '-ink' : '';
      downloadExport(new Blob([xml], { type: 'image/svg+xml' }), panel.name + suffix + '.svg');
    } else {
      const data = { format: 'nazori-coordinates/1', units: 'px', origin: 'top-left', width, height, pen: state.pen,
        strength: state.strength,
        inkContours: contours.map(({ points }) => ({ closed: true, points })),
        replayContours: [...model.contours].sort((a, b) => b.length - a.length)
          .map(({ points, length }) => ({ closed: true, length, points })),
        marks: panel.markers, sourceRoles: panel.sourceRoles, colorGroups: panelRoles(panel), separators: panel.barriers };
      downloadExport(new Blob([JSON.stringify(data)], { type: 'application/json' }), panel.name + '-coordinates.json');
    }
  }

  function downloadExport(blob, name) {
    download(blob, name);
    $('export-status').textContent = name + ' のダウンロードを開始しました。';
  }

  function openReplay({ returnToComparison = false } = {}) {
    if (replay) closeReplay();
    const panel = state.panels[selection.index];
    const model = geometry(panel);
    const { contours, layout } = model;
    const rebuilt = styled(model);
    const assignments = assignedColors(panel, layout);
    const swatches = palette(panel, selection.variant);
    const colors = E.paint(rebuilt, layout, assignments, swatches);
    const raw = panel.rgba;
    const inkPixels = rebuilt.ink;
    const { timing, jobs } = paintPlan(layout, assignments, swatches);
    const paths = [...contours].sort((a, b) => b.length - a.length);
    const total = paths.reduce((sum, shape) => sum + E.traceWeight(shape.length), 0);
    const distance = paths.reduce((sum, shape) => sum + shape.length, 0);
    const extraTime = Math.min(9000, Math.max(0, (distance - 85000) / 27));
    const inkTimeline = E.inkTimeline(rebuilt, paths, total);
    const image = $('movie');
    image.width = panel.width;
    image.height = panel.height;
    replay = { panel, paths, total, colors, raw, inkPixels, inkTimeline, timing, jobs, returnToComparison,
      colorStart: jobs.length ? .67 : 1, duration: (jobs.length ? duration : 11100) + extraTime,
      ctx: image.getContext('2d'), frame: new ImageData(panel.width, panel.height), position: 0, running: false };
    $('replay').hidden = false;
    renderScreen();
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
    if (t === 1) {
      if (visible) $('phase').textContent = '仕上がり';
      frame.data.set(colors);
      ctx.putImageData(frame, 0, 0);
      return;
    }
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
    if (visible) $('phase').textContent = '彩色';
    const colorTime = (t - colorStart) / (1 - colorStart);
    const d = frame.data;
    for (let i = 0; i < timing.length; i++) {
      const k = i * 4;
      const alpha = Math.min(1, Math.max(0, (colorTime - timing[i]) / .018));
      const base = inkPixels[i];
      d[k] = base + (colors[k] - base) * alpha;
      d[k + 1] = base + (colors[k + 1] - base) * alpha;
      d[k + 2] = base + (colors[k + 2] - base) * alpha;
      d[k + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
    const active = jobs.find(job => colorTime >= job.start && colorTime < job.start + job.length);
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
        if (model.returnToComparison) {
          closeReplay();
          report('トレスが完了しました。');
        } else {
          pauseReplay();
          report('工程の再生が終わりました。');
        }
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
    $('play').textContent = '▶ 工程を再生';
    if (state) {
      renderScreen();
      updateSourceKind();
    }
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
    render();
  }));
  $('work-screen').onclick = () => {
    if (replay) {
      closeReplay();
      return;
    }
    if (!exportSelection && selection.view !== 'works') return;
    if (selection.view === 'works') selection.view = defaultWorkView(state.panels[selection.index]);
    clearExport();
    render();
  };
  $('image-screen').onclick = () => {
    if (!exportSelection && selection.view === 'works') return;
    closeReplay();
    selection.view = 'works';
    clearExport();
    render();
  };
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
    render();
    report('前の編集に戻しました。');
  };
  $('redo').onclick = () => {
    const next = future.pop();
    if (!next) return;
    history.push({ state, selection: { ...selection } });
    closeReplay();
    ({ state, selection } = next);
    render();
    report('取り消した編集をやり直しました。');
  };
  $('reset-demo').onclick = async () => {
    if (history.length && !window.confirm('今の編集を閉じて、作例に戻りますか？')) return;
    closeReplay();
    try {
      await startDemo();
      setImportFeedback();
      report('トレス前の作例を開きました。');
    } catch { demoFailed(); }
  };
  $('highlight').onchange = () => render(false);
  $('palette-settings').ontoggle = () => {
    if (state && !replay && showsPalette() && $('highlight').checked) drawViews();
  };
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
  $('threshold').oninput = event => { $('threshold-value').textContent = event.target.value; };
  $('threshold').onchange = event => {
    remember();
    closeReplay();
    state = { ...state, threshold: Number(event.target.value) };
    render(false);
  };
  $('save-project').onclick = saveProject;
  $('open-project').onclick = () => $('project').click();
  $('project').onchange = () => readFiles($('project'), async ([file]) => {
    const project = await readProject(file);
    remember();
    closeReplay();
    clearExport();
    setImportFeedback();
    state = project;
    const preferences = state.preferences;
    const index = coordinate(preferences?.index, state.panels.length) ? preferences.index : 0;
    const role = preferences?.role ?? null;
    selection = { index, role, variant: preferences?.variant === 'b' ? 'b' : 'a',
      view: defaultWorkView(project.panels[index]) };
    restoreSpeeds(preferences);
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
      remember();
      selection.view = 'ink';
      selection.index = index;
      const panels = state.panels.map((panel, i) => i === index ? { name, ...image, markers: [], barriers: [], traced: false } : panel);
      state = { ...state, panels, roles: referencedRoles(panels), demo: false };
      render();
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
    clearExport();
    state = { ...state, name: isDemo ? '新しい原稿' : state.name, demo: false,
      roles: isDemo ? [] : state.roles, panels: [...current, ...panels] };
    selection.index = current.length;
    selection.view = 'ink';
    render();
    setImportFeedback();
    report(panels.length + '枚を読み込みました。「トレスする」で処理を開始します。');
  });
  $('export').onclick = async () => {
    const target = exportSelection;
    if (!target || savingExport || savingProject || busy) return;
    const { panel, mode } = target;
    const type = $('export-type').value;
    if ($('export-type').selectedOptions[0]?.disabled) return;
    if (panel.originalFile && $('export-size').value === 'original') {
      savingExport = true;
      const locked = ['export', 'export-type', 'export-size', 'close-export', 'import', 'open-project', 'save-project',
        'work-screen', 'image-screen'].map($);
      const previous = locked.map(input => input.disabled);
      locked.forEach(input => { input.disabled = true; });
      $('export-status').textContent = '元寸で処理中…';
      try {
        const blob = await originalExport(panel, mode, type);
        const suffix = type === 'png' ? '-' + mode : type === 'json' ? '-coordinates'
          : mode === 'b' ? '-b' : type === 'svg' && mode === 'ink' && panelHasColor(panel) ? '-ink' : '';
        downloadExport(blob, panel.name + suffix + '-original.' + type);
      } catch (error) {
        $('export-status').textContent = error.message || '元寸で保存できませんでした。プレビュー寸法で保存できます。';
      } finally {
        savingExport = false;
        locked.forEach((input, i) => { input.disabled = previous[i]; });
      }
      return;
    }
    try {
      if (type === 'psd') return savePsd(panel, mode);
      if (type === 'svg' || type === 'json') return saveVector(type, panel, mode);
      output(panel, mode).toBlob(blob => {
        if (blob) {
          if (exportSelection === target) downloadExport(blob, panel.name + '-' + mode + '.png');
          else download(blob, panel.name + '-' + mode + '.png');
        } else if (exportSelection === target) {
          $('export-status').textContent = 'PNGを作成できませんでした。';
        }
      }, 'image/png');
    } catch (error) {
      $('export-status').textContent = 'ファイルを作成できませんでした。もう一度お試しください。';
      console.error(error);
    }
  };
  $('export-type').onchange = () => { $('export-status').textContent = ''; };
  $('close-export').onclick = closeExport;
  const surfaces = [...document.querySelectorAll('header, main')];
  surfaces.forEach(element => { element.inert = true; });
  startDemo().catch(demoFailed).finally(() => surfaces.forEach(element => { element.inert = false; }));
})();
