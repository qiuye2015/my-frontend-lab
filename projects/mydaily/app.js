// MyDaily 个人管理系统 —— 精简实现
// 数据全部存 localStorage，结构兼容原站导出格式
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 24 * 3600 * 1000;

class App {
    constructor() {
        this.dailyData = JSON.parse(localStorage.getItem('dailyData')) || {};
        this.globalHabits = JSON.parse(localStorage.getItem('globalHabits')) || [];
        this.timerSettings = JSON.parse(localStorage.getItem('timerSettings')) || { workDuration: 25, shortBreak: 5, longBreak: 15, cyclesBeforeLongBreak: 4 };
        this.customTags = JSON.parse(localStorage.getItem('customTags')) || [];
        this.predefinedTags = ['工作', '学习', '个人', '健康', '家庭', '购物', '娱乐', '运动', '阅读', '项目'];
        this.timer = { state: 'stopped', type: 'work', remain: this.timerSettings.workDuration * 60, cycle: 0, interval: null, endTime: null };
        this.focusTask = null;
        this.editingTaskId = null;
        this.calendar = null;
        this.init();
    }

    // ---------- 数据 ----------
    getDateString(d) { return d.toISOString().split('T')[0]; }
    get currentDate() { return this.getDateString(new Date()); }

    defaultDay() {
        return { tasks: [], habits: [], notes: [], pomodoroSessions: [] };
    }

    dayData(date = this.currentDate) {
        if (!this.dailyData[date]) this.dailyData[date] = this.defaultDay();
        // 兼容旧数据：notes 曾是字符串
        if (typeof this.dailyData[date].notes === 'string') this.dailyData[date].notes = this.dailyData[date].notes.trim() ? [{ id: Date.now(), content: this.dailyData[date].notes, createdAt: new Date().toISOString() }] : [];
        this.syncHabits(date);
        return this.dailyData[date];
    }

    save() {
        // 每日轮转快照：保留最近 3 天数据，防浏览器清理/误删
        if (localStorage.getItem('dailyData_backup_date') !== this.currentDate) {
            for (let i = 3; i > 1; i--) {
                const prev = localStorage.getItem('dailyData_backup_' + (i - 1));
                if (prev) localStorage.setItem('dailyData_backup_' + i, prev);
            }
            const cur = localStorage.getItem('dailyData');
            if (cur) localStorage.setItem('dailyData_backup_1', cur);
            localStorage.setItem('dailyData_backup_date', this.currentDate);
        }
        localStorage.setItem('dailyData', JSON.stringify(this.dailyData));
    }
    saveHabits() { localStorage.setItem('globalHabits', JSON.stringify(this.globalHabits)); }
    saveTags() { localStorage.setItem('customTags', JSON.stringify(this.customTags)); }

    syncHabits(date) {
        const dd = this.dailyData[date];
        if (!dd || !Array.isArray(dd.habits)) dd.habits = [];
        const names = new Set(dd.habits.map(h => h.name));
        this.globalHabits.forEach(g => {
            if (!names.has(g.name)) dd.habits.push({ id: 'dh_' + Date.now() + '_' + g.name, name: g.name, completed: false, completedAt: null, globalHabitId: g.id });
        });
    }

    // 自动顺延：历史日期的未完成任务迁移到今天，done 留在原日期保真统计
    rolloverTasks() {
        const today = this.currentDate, dd = this.dayData();
        Object.keys(this.dailyData).sort().forEach(date => {
            if (date >= today) return;
            const stale = (this.dailyData[date].tasks || []).filter(t => t.status !== 'done');
            if (!stale.length) return;
            this.dailyData[date].tasks = this.dailyData[date].tasks.filter(t => t.status === 'done');
            dd.tasks.push(...stale);
        });
        this.save();
    }

    roundTime(t) { // 5 分钟取整 HH:mm
        if (!t) return null;
        const [h, m] = t.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return t;
        let mm = Math.round(m / 5) * 5, h2 = h;
        if (mm >= 60) { mm = 0; h2 = (h + 1) % 24; }
        return String(h2).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }

    // ---------- 初始化 ----------
    init() {
        this.bindEvents();
        this.rolloverTasks(); // 昨日未完成顺延到今天
        this.restoreTimer(); // 先恢复计时状态，再渲染默认值
        this.renderTasks();
        this.renderHabits();
        this.renderTimer();
        this.renderNotes();
        this.renderMatrix();
        this.renderStats();
        this.renderTimeProgress();
        this.restoreTimer();
    }

    bindEvents() {
        $('addTaskBtn')?.addEventListener('click', () => this.openTaskModal('todo'));
        $('taskForm')?.addEventListener('submit', e => this.submitTask(e));
        $('taskSearch')?.addEventListener('input', () => this.filterTasks());
        $('priorityFilter')?.addEventListener('change', () => this.filterTasks());
        $('statusFilter')?.addEventListener('change', () => this.filterTasks());
        $('taskStartTime')?.addEventListener('input', e => { $('taskEndTime').disabled = !e.target.value; if (!e.target.value) $('taskEndTime').value = ''; });
        $('taskStartTime')?.addEventListener('blur', e => { e.target.value = this.roundTime(e.target.value) || ''; $('taskEndTime').disabled = !e.target.value; });
        $('taskEndTime')?.addEventListener('blur', e => { e.target.value = this.roundTime(e.target.value) || ''; });
        document.querySelectorAll('.column-add-btn, .add-task-btn').forEach(b => b.addEventListener('click', () => this.openTaskModal(b.dataset.column)));

        $('playPauseBtn')?.addEventListener('click', () => this.toggleTimer());
        $('resetBtn')?.addEventListener('click', () => this.resetTimer());
        $('timerSettingsBtn')?.addEventListener('click', () => this.openModal('timerSettingsModal'));
        $('timerSettingsForm')?.addEventListener('submit', e => this.saveTimerSettings(e));
        $('startPomodoroBtn')?.addEventListener('click', () => this.startPomodoro());

        $('focusModeBtn')?.addEventListener('click', () => this.toggleFocus());
        $('exitFocusBtn')?.addEventListener('click', () => this.exitFocus());
        $('addHabitBtn')?.addEventListener('click', () => this.addHabit());
        $('addNoteBtn')?.addEventListener('click', () => $('quickNotesInput').focus());
        $('postNoteBtn')?.addEventListener('click', () => this.postNote());
        $('quickNotesInput')?.addEventListener('input', e => this.noteCount(e.target.value.length));
        document.querySelectorAll('[data-modal]').forEach(b => b.addEventListener('click', () => this.closeModal(b.dataset.modal || b.closest('[data-modal]').dataset.modal)));
        document.querySelector('input[type="file"]')?.addEventListener('change', e => this.importFile(e));
        document.addEventListener('keydown', e => this.shortcuts(e));
    }

    // ---------- 标签 ----------
    get allTags() { return [...this.predefinedTags, ...this.customTags]; }

    renderTags(selected = []) {
        const c = $('taskTagsContainer'); if (!c) return;
        const sel = tag => selected.includes(tag) ? 'selected' : '';
        c.innerHTML = `
            <div class="tag-selector">
                <div class="tag-input-section">
                    <input type="text" id="newTagInput" class="tag-input" placeholder="输入新标签或搜索现有标签...">
                    <button type="button" id="addTagBtn" class="add-tag-btn"><i class="fas fa-plus"></i></button>
                </div>
                <div class="selected-tags">${selected.map(t => `<span class="selected-tag" data-tag="${esc(t)}">${esc(t)}<i class="fas fa-times" onclick="app.removeTag('${esc(t)}')"></i></span>`).join('')}</div>
                <div class="available-tags">
                    <div class="tag-category"><h5>预设标签</h5><div class="tag-list">
                        ${this.predefinedTags.map(t => `<span class="available-tag ${sel(t)}" onclick="app.toggleTag('${esc(t)}')">${esc(t)}</span>`).join('')}
                    </div></div>
                    ${this.customTags.length ? `<div class="tag-category"><h5>自定义标签</h5><div class="tag-list">
                        ${this.customTags.map(t => `<span class="available-tag ${sel(t)}" onclick="app.toggleTag('${esc(t)}')">${esc(t)}<i class="fas fa-trash custom-tag-delete" onclick="event.stopPropagation();app.delCustomTag('${esc(t)}')"></i></span>`).join('')}
                    </div></div>` : ''}
                </div>
            </div>`;
        $('newTagInput').addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); this.addTagInput(); } });
        $('newTagInput').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#taskTagsContainer .available-tag').forEach(t => t.style.display = t.textContent.toLowerCase().includes(q) ? 'inline-flex' : 'none');
        });
        $('addTagBtn').addEventListener('click', () => this.addTagInput());
    }

    get selTags() { return [...document.querySelectorAll('#taskTagsContainer .selected-tag')].map(t => t.dataset.tag); }

    toggleTag(tag) { this.selTags.includes(tag) ? this.removeTag(tag) : this.addTag(tag); }

    addTag(tag) {
        const c = document.querySelector('#taskTagsContainer .selected-tags');
        c.insertAdjacentHTML('beforeend', `<span class="selected-tag" data-tag="${esc(tag)}">${esc(tag)}<i class="fas fa-times" onclick="app.removeTag('${esc(tag)}')"></i></span>`);
        document.querySelector(`#taskTagsContainer .available-tag[data-tag="${CSS.escape(tag)}"]`)?.classList.add('selected');
    }

    removeTag(tag) {
        document.querySelector(`#taskTagsContainer .selected-tag[data-tag="${CSS.escape(tag)}"]`)?.remove();
        document.querySelector(`#taskTagsContainer .available-tag[data-tag="${CSS.escape(tag)}"]`)?.classList.remove('selected');
    }

    addTagInput() {
        const input = $('newTagInput'); const v = input.value.trim();
        if (!v) return;
        if (this.allTags.includes(v)) this.toggleTag(v);
        else if (this.addCustomTag(v)) { this.renderTags(this.selTags); this.toggleTag(v); }
        input.value = '';
    }

    addCustomTag(t) { if (t && !this.allTags.includes(t)) { this.customTags.push(t); this.saveTags(); return true; } return false; }
    delCustomTag(t) { this.customTags = this.customTags.filter(x => x !== t); this.saveTags(); this.renderTags(this.selTags); }

    // ---------- 任务 ----------
    openTaskModal(status = 'todo') {
        this.editingTaskId = null;
        $('taskForm').reset(); $('taskStartTime').value = ''; $('taskEndTime').value = ''; $('taskEndTime').disabled = true; $('taskQuadrant').value = 'auto';
        document.querySelector('#addTaskModal h3').textContent = '新建任务';
        document.querySelector('#addTaskModal .btn-primary').textContent = '创建任务';
        this.renderTags([]);
        this.openModal('addTaskModal');
    }

    submitTask(e) {
        e.preventDefault();
        const d = this.dayData();
        const task = {
            id: Date.now(), title: $('taskTitle').value.trim(), description: $('taskDescription').value,
            priority: $('taskPriority').value, deadline: $('taskDeadline').value,
            startTime: this.roundTime($('taskStartTime').value), endTime: this.roundTime($('taskEndTime').value),
            tags: this.selTags, status: 'todo', createdAt: new Date().toISOString(), completedAt: null,
            matrixQuadrant: $('taskQuadrant').value === 'auto' ? null : +$('taskQuadrant').value
        };
        if (!task.title) return;
        if (this.editingTaskId) {
            const old = d.tasks.find(t => t.id === this.editingTaskId);
            if (old) {
                Object.assign(old, {
                    title: task.title, description: task.description, priority: task.priority,
                    deadline: task.deadline, startTime: task.startTime, endTime: task.endTime,
                    tags: task.tags, matrixQuadrant: task.matrixQuadrant
                });
                if (old.matrixQuadrant) this.moveToQuadrant(old.id, old.matrixQuadrant, false);
            }
            this.notify('任务更新成功！', 'success');
        } else {
            d.tasks.push(task);
            if (task.matrixQuadrant) this.moveToQuadrant(task.id, task.matrixQuadrant, false);
            this.notify('任务创建成功！', 'success');
        }
        this.save(); this.renderTasks(); this.renderMatrix(); this.closeModal('addTaskModal');
        this.editingTaskId = null;
    }

    editTask(id) {
        const task = this.dayData().tasks.find(t => t.id === id); if (!task) return;
        this.editingTaskId = id;
        document.querySelector('#addTaskModal h3').textContent = '编辑任务';
        document.querySelector('#addTaskModal .btn-primary').textContent = '更新任务';
        $('taskTitle').value = task.title; $('taskDescription').value = task.description;
        $('taskPriority').value = task.priority; $('taskDeadline').value = task.deadline;
        $('taskStartTime').value = task.startTime || ''; $('taskEndTime').value = task.endTime || '';
        $('taskEndTime').disabled = !task.startTime;
        $('taskQuadrant').value = task.matrixQuadrant ? String(task.matrixQuadrant) : 'auto';
        this.renderTags(task.tags);
        this.openModal('addTaskModal');
    }

    moveTask(id, status) {
        const task = this.dayData().tasks.find(t => t.id === id); if (!task) return;
        task.status = status;
        if (status === 'done') task.completedAt = new Date().toISOString();
        this.save(); this.renderTasks(); this.renderMatrix();
        this.notify(`任务已移动到${this.statusLabel(status)}`, 'info');
    }

    deleteTask(id) {
        if (!confirm('确定要删除这个任务吗？')) return;
        this.dayData().tasks = this.dayData().tasks.filter(t => t.id !== id);
        this.save(); this.renderTasks(); this.renderMatrix();
        this.notify('任务已删除', 'info');
    }

    filterTasks() {
        const q = $('taskSearch').value.toLowerCase(), p = $('priorityFilter').value, s = $('statusFilter').value;
        const tasks = this.dayData().tasks.filter(t =>
            (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some(x => x.toLowerCase().includes(q))) &&
            (!p || t.priority === p) && (!s || t.status === s));
        this.renderTasks(tasks);
    }

    statusLabel(s) { return ({ todo: '待办事项', 'in-progress': '进行中', done: '已完成' })[s] || s; }
    priorityLabel(p) { return ({ high: '高', medium: '中', low: '低' })[p] || p; }
    nextStatus(s) { return ({ todo: 'in-progress', 'in-progress': 'done', done: null })[s]; }
    statusIcon(s) { return ({ todo: 'fa-play', 'in-progress': 'fa-check', done: 'fa-redo' })[s] || 'fa-arrow-right'; }

    renderTasks(list = null) {
        if (!$('todoList')) return;
        const tasks = list || this.dayData().tasks;
        const ids = { todo: 'todoList', 'in-progress': 'inProgressList', done: 'doneList' };
        const counts = { todo: 0, 'in-progress': 0, done: 0 };
        Object.entries(ids).forEach(([st, elid]) => $(elid).innerHTML = '');
        tasks.forEach(t => {
            counts[t.status]++;
            $(ids[t.status]).appendChild(this.taskCard(t));
        });
        $('todoCount').textContent = counts.todo; $('inProgressCount').textContent = counts['in-progress']; $('doneCount').textContent = counts.done;
        this.taskStats(tasks);
        this.bindColumnDrops();
    }

    taskStats(tasks) {
        const total = tasks.length, done = tasks.filter(t => t.status === 'done').length;
        const rate = total ? Math.round(done / total * 100) : 0;
        const el = document.querySelector('.daily-task-stats');
        if (el) el.innerHTML = `<span>今日任务进度：${done}/${total} 完成</span><div class="stats-right"><span>完成率: ${rate}%</span><div class="mini-bar"><div style="width:${rate}%"></div></div></div>`;
    }

    taskCard(t) {
        const el = document.createElement('div');
        el.className = `task-item priority-${t.priority}`;
        el.draggable = true; el.dataset.taskId = t.id;
        const overdue = t.deadline && new Date(t.deadline + (t.endTime ? 'T' + t.endTime : 'T23:59:59')) < new Date() && t.status !== 'done';
        const ageDays = t.createdAt ? Math.round((new Date(this.currentDate) - new Date(t.createdAt.slice(0, 10))) / DAY) : 0; // 日历日差，与创建时刻无关
        const next = this.nextStatus(t.status);
        el.innerHTML = `
            <div class="task-header"><div class="task-title">${esc(t.title)}</div><span class="task-priority ${t.priority}">${this.priorityLabel(t.priority)}</span></div>
            ${t.description ? `<div class="task-description">${esc(t.description)}</div>` : ''}
            <div class="task-meta">
                <div class="task-datetime-details">
                    ${t.deadline ? `<div class="task-deadline-info ${overdue ? 'overdue' : ''}"><i class="fas fa-calendar"></i> ${esc(new Date(t.deadline).toLocaleDateString('zh-CN'))}</div>` : ''}
                    ${t.startTime ? `<div class="task-time-info"><i class="fas fa-clock"></i> ${esc(t.startTime)}${t.endTime ? ' - ' + esc(t.endTime) : ''}</div>` : ''}
                    ${ageDays >= 1 ? `<span class="task-stale ${ageDays >= 3 ? 'warn' : ''}"><i class="fas fa-clock-rotate-left"></i> 滞留 ${ageDays} 天</span>` : ''}
                </div>
                <div class="task-actions">
                    ${next ? `<button onclick="app.moveTask(${t.id},'${next}')" class="task-action-btn" title="更改为${this.statusLabel(next)}"><i class="fas ${this.statusIcon(next)}"></i></button>` : ''}
                    <button onclick="app.editTask(${t.id})" class="task-action-btn" title="编辑"><i class="fas fa-edit"></i></button>
                    <button onclick="app.deleteTask(${t.id})" class="task-action-btn" title="删除"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            ${t.tags.length ? `<div class="task-tags">${t.tags.map(x => `<span class="task-tag">${esc(x)}</span>`).join('')}</div>` : ''}`;
        el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', t.id); el.classList.add('dragging'); });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('dblclick', () => this.enterFocus(t));
        return el;
    }

    bindColumnDrops() {
        document.querySelectorAll('.kanban-column').forEach(col => {
            col.ondragover = e => { e.preventDefault(); col.classList.add('drag-over'); };
            col.ondragleave = () => col.classList.remove('drag-over');
            col.ondrop = e => { e.preventDefault(); col.classList.remove('drag-over'); this.moveTask(+e.dataTransfer.getData('text/plain'), col.dataset.status); };
        });
    }

    // ---------- 番茄钟 ----------
    startPomodoro() { this.timer.type = 'work'; this.timer.remain = this.timerSettings.workDuration * 60; this.renderTimer(); this.toggleTimer(); }
    toggleTimer() { this.timer.state === 'running' ? this.pauseTimer() : this.startTimer(); }

    // 计时器状态持久化：存截止时间戳而非倒计时，跨页面/刷新用 endTime-now 反算，不会漂移
    persistTimer() {
        const t = this.timer;
        const s = t.state === 'stopped' ? null : { state: t.state, type: t.type, remain: t.remain, endTime: t.endTime, cycle: t.cycle };
        localStorage.setItem('timerState', JSON.stringify(s));
    }

    restoreTimer() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem('timerState')); } catch (e) {}
        if (!s) return;
        this.timer.type = s.type || 'work';
        this.timer.cycle = s.cycle || 0;
        if (s.state === 'running' && s.endTime) {
            if (s.endTime > Date.now()) {
                this.timer.remain = Math.max(1, Math.round((s.endTime - Date.now()) / 1000));
                this.startTimer();
            } else { this.timer.state = 'running'; this.timer.remain = 0; this.timerDone(); } // 离开期间已到点，补记会话
        } else if (s.state === 'paused') {
            this.timer.state = 'paused';
            this.timer.remain = s.remain;
            this.renderTimer();
        }
    }

    startTimer() {
        clearInterval(this.timer.interval); // 防重入：清掉任何残留 interval
        this.stopTitleAlert();
        this.timer.state = 'running';
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); // 借用户手势请求授权
        this.timer.endTime = Date.now() + this.timer.remain * 1000;
        this.persistTimer();
        this.renderTimer();
        this.timer.interval = setInterval(() => {
            if (this.timer.state !== 'running' || this.timer.endTime === null) return; // 状态已重置，本轮作废
            this.timer.remain = Math.max(0, Math.round((this.timer.endTime - Date.now()) / 1000));
            this.renderTimer();
            if (this.timer.remain <= 0) this.timerDone();
        }, 1000);
    }

    pauseTimer() {
        if (this.timer.state !== 'running' || this.timer.endTime === null) return;
        this.timer.remain = Math.max(0, Math.round((this.timer.endTime - Date.now()) / 1000));
        this.timer.state = 'paused'; this.timer.endTime = null; clearInterval(this.timer.interval); this.timer.interval = null;
        this.persistTimer();
        this.renderTimer();
    }

    resetTimer() {
        this.timer.state = 'stopped'; this.timer.endTime = null; clearInterval(this.timer.interval); this.timer.interval = null;
        this.persistTimer();
        this.timer.remain = this.duration(this.timer.type) * 60;
        this.renderTimer();
    }

    duration(type) { return ({ work: this.timerSettings.workDuration, shortBreak: this.timerSettings.shortBreak, longBreak: this.timerSettings.longBreak })[type]; }

    timerDone() {
        if (this.timer.state !== 'running') return; // 幂等守卫：无论上游重复触发多少次，副作用只发生一次
        clearInterval(this.timer.interval); this.timer.interval = null;
        this.timer.state = 'stopped'; this.timer.endTime = null;
        this.dayData().pomodoroSessions.push({
            startTime: new Date(Date.now() - this.duration(this.timer.type) * 60000).toISOString(),
            endTime: new Date().toISOString(), type: this.timer.type, taskId: null
        });
        this.save(); this.renderStats();
        this.beep();
        this.alertTitle();
        if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification('MyDaily 番茄钟', { body: this.timer.type === 'work' ? '工作完成！起来休息一下' : '休息结束！准备开始下一轮' });
            n.onclick = () => { window.focus(); n.close(); };
        }
        if (this.timer.type === 'work') {
            this.timer.cycle++;
            if (this.focusTask && this.focusTask.status !== 'done' && confirm(`专注结束，将「${this.focusTask.title}」标记为已完成？`)) this.moveTask(this.focusTask.id, 'done');
            if (this.timer.cycle % this.timerSettings.cyclesBeforeLongBreak === 0) { this.setPhase('longBreak'); this.notify('工作完成！开始长休息', 'success'); }
            else { this.setPhase('shortBreak'); this.notify('工作完成！开始短休息', 'success'); }
        } else { this.setPhase('work'); this.notify('休息结束！开始工作', 'info'); }
    }

    setPhase(type) { this.timer.type = type; this.timer.remain = this.duration(type) * 60; this.timer.endTime = null; this.timer.interval = null; this.persistTimer(); this.renderTimer(); }

    // ---------- 到点提醒：标题闪烁（后台标签可见），回前台即停 ----------
    alertTitle() {
        if (this.titleTimer) return;
        this.titleOrig = document.title;
        this.titleTimer = setInterval(() => {
            document.title = document.title === '⏰ 时间到！' ? this.titleOrig : '⏰ 时间到！';
        }, 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.stopTitleAlert(); }, { once: true });
    }

    stopTitleAlert() {
        if (!this.titleTimer) return;
        clearInterval(this.titleTimer); this.titleTimer = null;
        document.title = this.titleOrig;
    }

    renderTimer() {
        const m = String(Math.floor(this.timer.remain / 60)).padStart(2, '0');
        const s = String(this.timer.remain % 60).padStart(2, '0');
        const label = ({ work: '工作时间', shortBreak: '短休息', longBreak: '长休息' })[this.timer.type];
        const pb = $('playPauseBtn'); if (pb) pb.innerHTML = this.timer.state === 'running' ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
        if ($('timerDisplay')) { $('timerDisplay').textContent = m + ':' + s; $('timerLabel').textContent = label; }
        if ($('focusTimer')) $('focusTimer').textContent = m + ':' + s;
        const circle = document.querySelector('.progress-ring-circle');
        if (circle) {
            const total = this.duration(this.timer.type) * 60;
            const circ = 2 * Math.PI * 50;
            circle.style.strokeDasharray = circ;
            circle.style.strokeDashoffset = circ * (1 - (total - this.timer.remain) / total);
            circle.style.stroke = this.timer.type === 'work' ? '#4f46e5' : '#10b981';
        }
    }

    saveTimerSettings(e) {
        e.preventDefault();
        this.timerSettings = {
            workDuration: +$('workDuration').value, shortBreak: +$('shortBreak').value,
            longBreak: +$('longBreak').value, cyclesBeforeLongBreak: +$('cyclesBeforeLongBreak').value
        };
        localStorage.setItem('timerSettings', JSON.stringify(this.timerSettings));
        this.closeModal('timerSettingsModal'); this.resetTimer();
        this.notify('番茄钟设置已保存', 'success');
    }

    // ---------- 统计与成就 ----------
    renderStats() {
        const stats = this.stats();
        const todayPct = Math.min(stats.today / stats.todayGoal * 100, 100);
        const weekPct = Math.min(stats.week / stats.weeklyGoal * 100, 100);
        const el = $('pomodoroStats'); if (!el) return;
        el.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item"><div class="stat-number">${stats.today}</div><div class="stat-label">今日番茄钟</div><div class="stat-progress"><div class="progress-bar" style="width:${todayPct}%"></div></div><div class="stat-goal">${stats.today}/${stats.todayGoal}</div></div>
                <div class="stat-item"><div class="stat-number">${stats.week}</div><div class="stat-label">本周番茄钟</div><div class="stat-progress"><div class="progress-bar" style="width:${weekPct}%"></div></div><div class="stat-goal">${stats.week}/${stats.weeklyGoal}</div></div>
                <div class="stat-item"><div class="stat-number">${stats.total}</div><div class="stat-label">总计番茄钟</div></div>
                <div class="stat-item"><div class="stat-number">${stats.streak}</div><div class="stat-label">连续天数</div><div class="streak-fire">🔥</div></div>
            </div>`;
    }

    stats() {
        let total = 0, week = 0, today = 0;
        const now = new Date();
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
        Object.entries(this.dailyData).forEach(([date, dd]) => {
            const n = (dd.pomodoroSessions || []).filter(s => s.type === 'work').length;
            total += n;
            if (date >= this.getDateString(weekStart)) week += n;
            if (date === this.currentDate) today = n;
        });
        return { today, week, total, streak: this.pomodoroStreak(), todayGoal: 8, weeklyGoal: 40 };
    }

    pomodoroStreak() {
        let streak = 0;
        const dates = Object.keys(this.dailyData).sort().reverse();
        for (const date of dates) {
            if (date > this.currentDate) continue;
            if ((this.dailyData[date].pomodoroSessions || []).some(s => s.type === 'work')) streak++;
            else if (date < this.currentDate) break;
        }
        return streak;
    }

    // ---------- 时间进度 ----------
    renderTimeProgress() {
        const el = $('timeProgress'); if (!el) return;
        const now = new Date();
        const pct = (start, end) => (now - start) / (end - start) * 100;
        const daysLeft = end => Math.ceil((end - now) / DAY);
        const yStart = new Date(now.getFullYear(), 0, 1), yEnd = new Date(now.getFullYear() + 1, 0, 1);
        const q = Math.floor(now.getMonth() / 3);
        const qStart = new Date(now.getFullYear(), q * 3, 1), qEnd = new Date(now.getFullYear(), q * 3 + 3, 1);
        const row = (label, p, end) => `
            <div class="time-progress-row">
                <span class="tp-label">${label}</span>
                <div class="tp-bar"><div style="width:${p.toFixed(1)}%"></div></div>
                <span class="tp-pct">${Math.floor(p)}%</span>
                <span class="tp-left">剩 ${daysLeft(end)} 天</span>
            </div>`;
        el.innerHTML = row(`${now.getFullYear()} 年`, pct(yStart, yEnd), yEnd) + row(`Q${q + 1} 季度`, pct(qStart, qEnd), qEnd);
    }

    // ---------- 专注模式 ----------
    toggleFocus() {
        const overlay = $('focusOverlay');
        if (!overlay) return this.notify('专注模式仅在主仪表盘页面可用', 'info');
        overlay.classList.toggle('active');
        document.body.style.overflow = overlay.classList.contains('active') ? 'hidden' : '';
        if (overlay.classList.contains('active')) this.focusTaskList();
    }

    enterFocus(task) {
        if (task) this.focusTask = task;
        this.focusTaskDisplay();
        this.toggleFocus();
        if (this.timer.state === 'stopped') this.startTimer(); // 延续当前阶段，不重置
    }

    exitFocus() {
        const overlay = $('focusOverlay');
        overlay?.classList.remove('active');
        document.body.style.overflow = '';
    }

    focusTaskDisplay() {
        const el = $('currentFocusTask'); if (!el) return;
        const btn = $('completeFocusTaskBtn');
        if (this.focusTask) {
            el.textContent = this.focusTask.title;
            btn.style.display = this.focusTask.status === 'done' ? 'none' : 'inline-flex';
        } else {
            el.textContent = '点击选择任务'; btn.style.display = 'none';
        }
    }

    focusTaskList() {
        const tasks = this.dayData().tasks.filter(t => t.status !== 'done');
        const p = document.querySelector('.focus-content p');
        let list = document.querySelector('.focus-task-list');
        if (!list) { list = document.createElement('div'); list.className = 'focus-task-list'; p.insertAdjacentElement('afterend', list); }
        list.innerHTML = tasks.length ? `<h3>选择要专注的任务：</h3><div class="focus-tasks-grid">
            ${tasks.map(t => `<div class="focus-task-item ${this.focusTask?.id === t.id ? 'selected' : ''}" onclick="app.selectFocusTask(${t.id})">
                <div class="focus-task-priority priority-${t.priority}"></div>
                <div class="focus-task-content"><div class="focus-task-title">${esc(t.title)}</div><div class="focus-task-status">${this.statusLabel(t.status)}</div></div>
            </div>`).join('')}</div>`
            : '<p style="opacity:.6;font-size:.9rem">暂无可用任务</p>';
    }

    selectFocusTask(id) {
        const task = this.dayData().tasks.find(t => t.id === id); if (!task) return;
        this.focusTask = task;
        this.focusTaskDisplay(); this.focusTaskList();
        if (task.status === 'todo') this.moveTask(id, 'in-progress');
        this.notify(`开始专注：${task.title}`, 'info');
    }

    completeFocusTask() {
        if (!this.focusTask) return;
        this.moveTask(this.focusTask.id, 'done');
        this.notify(`任务完成：${this.focusTask.title}`, 'success');
        this.focusTask = null; this.focusTaskDisplay(); this.focusTaskList();
    }

    // ---------- 习惯 ----------
    addHabit() {
        const name = prompt('请输入习惯名称：'); if (!name?.trim()) return;
        const n = name.trim();
        if (this.globalHabits.some(h => h.name === n)) return this.notify('已存在同名习惯。', 'warning');
        this.globalHabits.push({ id: 'gh_' + Date.now() + '_' + n, name: n, createdAt: new Date().toISOString() });
        this.saveHabits(); this.syncHabits(this.currentDate); this.save();
        this.renderHabits(); this.notify('习惯添加成功！它将每日显示。', 'success');
    }

    toggleHabit(id) {
        const habit = this.dayData().habits.find(h => h.id === id); if (!habit) return;
        habit.completed = !habit.completed;
        habit.completedAt = habit.completed ? new Date().toISOString() : null;
        if (habit.completed) this.notify(`习惯完成！连续 ${this.habitStreak(habit.name)} 天`, 'success');
        this.save(); this.renderHabits();
    }

    habitStreak(name) {
        let streak = 0;
        for (const date of Object.keys(this.dailyData).sort().reverse()) {
            const h = (this.dailyData[date].habits || []).find(x => x.name === name);
            if (h?.completed) streak++;
            else if (date < this.currentDate) break;
            else if (!h) break;
        }
        return streak;
    }

    renderHabits() {
        const grid = $('habitsGrid'); if (!grid) return;
        const habits = this.dayData().habits;
        grid.innerHTML = habits.length ? habits.map(h => `
            <div class="habit-item">
                <div class="habit-info"><div class="habit-name">${esc(h.name)}</div><div class="habit-streak">连续 ${this.habitStreak(h.name)} 天</div></div>
                <div class="habit-check ${h.completed ? 'completed' : ''}" onclick="app.toggleHabit('${esc(h.id)}')">${h.completed ? '<i class="fas fa-check"></i>' : ''}</div>
            </div>`).join('')
            : '<p class="empty-state">还没有添加习惯，点击上方"添加习惯"按钮开始吧！</p>';
    }

    // ---------- 优先级矩阵（只读视图，点击调起编辑） ----------
    renderMatrix() {
        if (!$('quadrant1')) return;
        const tasks = this.dayData().tasks.filter(t => t.status !== 'done');
        for (let i = 1; i <= 4; i++) $('quadrant' + i).innerHTML = '';
        tasks.forEach(t => {
            const el = document.createElement('div');
            el.className = 'matrix-item'; el.dataset.taskId = t.id;
            const overdue = t.deadline && new Date(t.deadline) < new Date();
            el.innerHTML = `
                <div class="matrix-task-header"><span class="matrix-task-title">${esc(t.title)}</span><span class="matrix-task-priority priority-${t.priority}">${this.priorityLabel(t.priority)}</span></div>
                <div class="matrix-task-meta">
                    ${t.deadline ? `<span class="matrix-task-deadline ${overdue ? 'overdue' : ''}"><i class="fas fa-calendar"></i> ${esc(new Date(t.deadline).toLocaleDateString('zh-CN'))}</span>` : ''}
                    <span class="matrix-task-status">${this.statusLabel(t.status)}</span>
                </div>
                ${t.tags.length ? `<div class="matrix-task-tags">${t.tags.slice(0, 2).map(x => `<span class="matrix-tag">${esc(x)}</span>`).join('')}${t.tags.length > 2 ? `<span class="matrix-tag-more">+${t.tags.length - 2}</span>` : ''}</div>` : ''}`;
            el.addEventListener('click', () => this.editTask(t.id));
            $('quadrant' + this.getQuadrant(t)).appendChild(el);
        });
    }

    getQuadrant(t) {
        if (t.matrixQuadrant) return t.matrixQuadrant;
        const u = this.urgent(t), i = this.important(t);
        return u && i ? 1 : !u && i ? 2 : u && !i ? 3 : 4;
    }

    urgent(t) {
        if (!t.deadline) return false;
        return Math.ceil((new Date(t.deadline) - new Date()) / DAY) <= 3;
    }

    important(t) {
        if (t.priority === 'high') return true;
        return t.tags.some(x => ['工作', '项目', '学习', '健康'].includes(x));
    }

    moveToQuadrant(id, q) {
        const task = this.dayData().tasks.find(t => t.id === id); if (!task) return;
        task.matrixQuadrant = q;
        this.save(); this.renderMatrix(); this.renderTasks();
    }

    // ---------- 笔记 ----------
    postNote() {
        const input = $('quickNotesInput'); const content = input.value.trim();
        if (!content) return this.notify('笔记内容不能为空！', 'warning');
        this.dayData().notes.unshift({ id: Date.now(), content, createdAt: new Date().toISOString() });
        this.save(); this.renderNotes();
        input.value = ''; this.noteCount(0);
        this.notify('笔记已发布！', 'success');
    }

    renderNotes() {
        const c = $('noteStreamContainer'); if (!c) return;
        const notes = this.dayData().notes;
        c.innerHTML = notes.length ? notes.map(n => `
            <div class="note-entry">
                <div class="note-entry-header"><span class="note-entry-timestamp">${esc(new Date(n.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))}</span>
                <button class="note-entry-delete-btn" onclick="app.delNote(${n.id})"><i class="fas fa-times"></i></button></div>
                <div class="note-entry-content">${esc(n.content).replace(/\n/g, '<br>')}</div>
            </div>`).join('')
            : '<p class="empty-notes-placeholder">还没有笔记，快写下你的想法吧！</p>';
    }

    delNote(id) {
        if (!confirm('确定要删除这条笔记吗？')) return;
        this.dayData().notes = this.dayData().notes.filter(n => n.id !== id);
        this.save(); this.renderNotes(); this.notify('笔记已删除', 'info');
    }

    noteCount(n) { document.querySelector('.notes-card .char-count').textContent = n + ' 字符'; }

    // ---------- 数据管理 ----------
    exportData() {
        const data = { dailyData: this.dailyData, timerSettings: this.timerSettings, exportDate: new Date().toISOString(), version: '1.0' };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `MyDaily-${this.currentDate}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.notify('数据导出成功！', 'success');
    }

    importData() { document.querySelector('input[type="file"]')?.click(); }

    importFile(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (!data.dailyData) throw new Error('无效的数据格式');
                if (confirm('是否要合并数据？点击"确定"合并，点击"取消"覆盖现有数据。')) {
                    Object.entries(data.dailyData).forEach(([date, dd]) => {
                        if (this.dailyData[date] && !confirm(`日期 ${date} 的数据已存在，是否覆盖？`)) return;
                        this.dailyData[date] = dd;
                    });
                } else this.dailyData = data.dailyData;
                if (data.timerSettings) { this.timerSettings = data.timerSettings; localStorage.setItem('timerSettings', JSON.stringify(data.timerSettings)); }
                this.save(); this.refresh();
                this.notify('数据导入成功！', 'success');
            } catch (err) { this.notify('导入失败：' + err.message, 'error'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    clearAll() {
        if (!confirm('警告：此操作将永久删除所有数据（任务、习惯、笔记、设置等），无法恢复！\n\n建议先导出备份。确定继续吗？')) return;
        ['dailyData', 'globalHabits', 'timerSettings', 'customTags', 'timerState'].forEach(k => localStorage.removeItem(k));
        location.reload();
    }

    refresh() {
        this.renderTasks(); this.renderHabits(); this.renderNotes(); this.renderMatrix(); this.renderStats();
    }

    // ---------- 通用 ----------
    openModal(id) { $(id).classList.add('active'); }

    closeModal(id) {
        const m = $(id); if (!m) return;
        m.classList.remove('active');
        if (id === 'addTaskModal') { this.editingTaskId = null; $('taskForm').reset(); $('taskQuadrant').value = 'auto'; }
    }

    notify(msg, type = 'info') {
        const n = document.createElement('div');
        const icons = { success: 'check-circle', warning: 'exclamation-triangle', error: 'times-circle', info: 'info-circle' };
        n.className = `notification notification-${type}`;
        n.innerHTML = `<i class="fas fa-${icons[type]}"></i><span>${esc(msg)}</span>`;
        document.body.appendChild(n);
        requestAnimationFrame(() => n.classList.add('show'));
        setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 3000);
    }

    beep() { // 3 组双音，约 1.5 秒，明显可闻
        try {
            const ctx = new (AudioContext || webkitAudioContext)();
            [0, .5, 1].forEach(t => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.setValueAtTime(800, ctx.currentTime + t);
                o.frequency.setValueAtTime(600, ctx.currentTime + t + .15);
                g.gain.setValueAtTime(.3, ctx.currentTime + t);
                g.gain.exponentialRampToValueAtTime(.01, ctx.currentTime + t + .3);
                o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .3);
            });
        } catch (e) {}
    }

    shortcuts(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'n': e.preventDefault(); this.openTaskModal(); break;
                case 's': e.preventDefault(); this.postNote(); break;
                case ' ': e.preventDefault(); this.toggleTimer(); break;
                case 'f': e.preventDefault(); this.toggleFocus(); break;
                case 'e': e.preventDefault(); this.exportData(); break;
                case 'i': e.preventDefault(); this.importData(); break;
            }
        }
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
            this.exitFocus();
        }
    }

    // ---------- 日历辅助 ----------
    findTask(id) {
        for (const [date, dd] of Object.entries(this.dailyData)) {
            const i = (dd.tasks || []).findIndex(t => String(t.id) === String(id));
            if (i !== -1) return { task: dd.tasks[i], date, i };
        }
        return null;
    }

    updateTaskDateTime(id, newDate, newStart, allDay) {
        const f = this.findTask(id); if (!f) return;
        f.task.deadline = newDate;
        if (allDay) { f.task.startTime = null; f.task.endTime = null; }
        else if (newStart) { f.task.startTime = newStart; }
        else { f.task.startTime = null; f.task.endTime = null; }
        if (f.date !== newDate) {
            this.dailyData[f.date].tasks.splice(f.i, 1);
            const target = this.dayData(newDate);
            target.tasks.push(f.task);
        }
        this.save(); this.renderTasks(); this.renderMatrix();
        this.calendar?.refetchEvents();
        this.notify('任务日期/时间已更新', 'success');
    }
}

// 脚本在 body 底部，DOM 已就绪：立即构造，消除计时器恢复前的静态闪烁
let app = new App();
window.app = app;

