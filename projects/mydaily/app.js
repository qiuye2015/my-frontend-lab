// MyDaily 个人管理系统 —— 精简实现
// 数据全部存 localStorage，结构兼容原站导出格式
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 24 * 3600 * 1000;

// ---------- 全局错误捕获 ----------
// 任何 async 拒绝 / 同步抛错都从这里走，便于定位 `.session` 等幽灵报错
window.addEventListener('error', e => {
    console.error('[app error]', e.message, e.filename + ':' + e.lineno + ':' + e.colno, e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', e => {
    const r = e.reason || {};
    console.error('[app unhandledrejection]', r.message || r, r && r.stack);
});

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
        if (localStorage.getItem('dailyData_backup_date') !== this.currentDate) {
            for (let i = 3; i > 1; i--) {
                const prev = localStorage.getItem('dailyData_backup_' + (i - 1));
                if (prev) localStorage.setItem('dailyData_backup_' + i, prev);
            }
            const cur = localStorage.getItem('dailyData');
            if (cur) localStorage.setItem('dailyData_backup_1', cur);
            localStorage.setItem('dailyData_backup_date', this.currentDate);
        }
        try {
            localStorage.setItem('dailyData', JSON.stringify(this.dailyData));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                this.notify('存储空间已满，请导出数据后清空历史记录', 'error');
            }
        }
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
        try {
            this.bindEvents();
            this.rolloverTasks(); // 昨日未完成顺延到今天

            // 三页面分发：仪表盘 / 统计 / 日历
            const path = location.pathname;
            if (path.includes('dashboard.html')) {
                // Chart.js 在 app.js 之后加载，需等 DOMContentLoaded 后再渲染
                document.addEventListener('DOMContentLoaded', () => this.renderDashboard());
            } else if (path.includes('calendar.html')) {
                document.addEventListener('DOMContentLoaded', () => this.renderCalendar());
            } else {
                this.restoreTimer(); // 主页才需要恢复计时状态
                this.renderTasks();
                this.renderHabits();
                this.renderTimer();
                this.renderNotes();
                this.renderMatrix();
                this.renderStats();
                this.renderTimeProgress();
            }
        } catch (err) {
            // 兜底：init 任意阶段抛错都不应让页面挂掉
            console.error('[app init failed]', err && err.message, err && err.stack);
        }
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
        $('completeFocusTaskBtn')?.addEventListener('click', () => this.completeFocusTask());
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
                    <label for="newTagInput" class="sr-only">添加或搜索标签</label>
                    <input type="text" id="newTagInput" class="tag-input" placeholder="输入新标签或搜索现有标签...">
                    <button type="button" id="addTagBtn" class="add-tag-btn" aria-label="添加标签"><i class="fas fa-plus"></i></button>
                </div>
                <div class="selected-tags">${selected.map(t => `<span class="selected-tag" data-tag="${esc(t)}">${esc(t)}<i class="fas fa-times" data-remove-tag="${esc(t)}"></i></span>`).join('')}</div>
                <div class="available-tags">
                    <div class="tag-category"><h5>预设标签</h5><div class="tag-list">
                        ${this.predefinedTags.map(t => `<span class="available-tag ${sel(t)}" data-toggle-tag="${esc(t)}">${esc(t)}</span>`).join('')}
                    </div></div>
                    ${this.customTags.length ? `<div class="tag-category"><h5>自定义标签</h5><div class="tag-list">
                        ${this.customTags.map(t => `<span class="available-tag ${sel(t)}" data-toggle-tag="${esc(t)}">${esc(t)}<i class="fas fa-trash custom-tag-delete" data-del-tag="${esc(t)}"></i></span>`).join('')}
                    </div></div>` : ''}
                </div>
            </div>`;
        $('newTagInput').addEventListener('keypress', e => { if (e.key === 'Enter') { e.preventDefault(); this.addTagInput(); } });
        $('newTagInput').addEventListener('input', e => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#taskTagsContainer .available-tag').forEach(t => t.style.display = t.textContent.toLowerCase().includes(q) ? 'inline-flex' : 'none');
        });
        $('addTagBtn').addEventListener('click', () => this.addTagInput());
        c.onclick = e => {
            const removeBtn = e.target.closest('[data-remove-tag]');
            if (removeBtn) { this.removeTag(removeBtn.dataset.removeTag); return; }
            const toggleBtn = e.target.closest('[data-toggle-tag]');
            if (toggleBtn) { this.toggleTag(toggleBtn.dataset.toggleTag); return; }
            const delBtn = e.target.closest('[data-del-tag]');
            if (delBtn) { e.stopPropagation(); this.delCustomTag(delBtn.dataset.delTag); return; }
        };
    }

    get selTags() { return [...document.querySelectorAll('#taskTagsContainer .selected-tag')].map(t => t.dataset.tag); }

    toggleTag(tag) { this.selTags.includes(tag) ? this.removeTag(tag) : this.addTag(tag); }

    addTag(tag) {
        const c = document.querySelector('#taskTagsContainer .selected-tags');
        c.insertAdjacentHTML('beforeend', `<span class="selected-tag" data-tag="${esc(tag)}">${esc(tag)}<i class="fas fa-times" data-remove-tag="${esc(tag)}"></i></span>`);
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
        const ageDays = t.createdAt ? Math.round((new Date(this.currentDate) - new Date(t.createdAt.slice(0, 10))) / DAY) : 0;
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
                    ${next ? `<button class="task-action-btn" data-move-task="${t.id}" data-move-status="${next}" title="更改为${this.statusLabel(next)}"><i class="fas ${this.statusIcon(next)}"></i></button>` : ''}
                    <button class="task-action-btn" data-edit-task="${t.id}" title="编辑"><i class="fas fa-edit"></i></button>
                    <button class="task-action-btn" data-delete-task="${t.id}" title="删除"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            ${t.tags.length ? `<div class="task-tags">${t.tags.map(x => `<span class="task-tag">${esc(x)}</span>`).join('')}</div>` : ''}`;
        el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', t.id); el.classList.add('dragging'); });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('dblclick', () => this.enterFocus(t));
        el.addEventListener('click', e => {
            const moveBtn = e.target.closest('[data-move-task]');
            if (moveBtn) { this.moveTask(+moveBtn.dataset.moveTask, moveBtn.dataset.moveStatus); return; }
            const editBtn = e.target.closest('[data-edit-task]');
            if (editBtn) { this.editTask(+editBtn.dataset.editTask); return; }
            const delBtn = e.target.closest('[data-delete-task]');
            if (delBtn) { this.deleteTask(+delBtn.dataset.deleteTask); return; }
        });
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
        const pct = (start, end) => Math.max(0, Math.min(100, (now - start) / (end - start) * 100));
        const daysLeft = end => Math.ceil((end - now) / DAY);
        const clamp01 = v => Math.max(0, Math.min(1, v));

        // 公历日期头部
        const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
        const solarHeader = `
            <div class="tp-date-header">
                <div class="tp-date-solar">${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${weekNames[now.getDay()]}</div>
            </div>`;

        // 农历信息
        let lunarHtml = '';
        if (typeof Solar !== 'undefined') {
            try {
                const solar = Solar.fromDate(now);
                const lunar = solar.getLunar();
                const ganZhi = lunar.getYearInGanZhi();
                const shengXiao = lunar.getYearShengXiao();
                const monthCn = lunar.getMonthInChinese();
                const dayCn = lunar.getDayInChinese();
                lunarHtml = `<div class="tp-date-lunar">农历${monthCn}月${dayCn} · ${ganZhi}${shengXiao}年</div>`;
            } catch(e) { /* 库加载失败时静默降级 */ }
        }

        // 公历年 + 季度进度条
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
        let html = solarHeader + lunarHtml;
        html += row(`${now.getFullYear()} 年`, pct(yStart, yEnd), yEnd);
        html += row(`Q${q + 1} 季度`, pct(qStart, qEnd), qEnd);

        // 农历进度 + 春节倒计时
        if (typeof Lunar !== 'undefined') {
            try {
                const todayLunar = Solar.fromDate(now).getLunar();

                const curYearFestival = Lunar.fromYmd(todayLunar.getYear(), 1, 1).getSolar();
                const curFestivalDate = new Date(curYearFestival.getYear(), curYearFestival.getMonth() - 1, curYearFestival.getDay());
                const nextLunarYear = todayLunar.getYear() + 1;
                const nextYearFestival = Lunar.fromYmd(nextLunarYear, 1, 1).getSolar();
                const nextFestivalDate = new Date(nextYearFestival.getYear(), nextYearFestival.getMonth() - 1, nextYearFestival.getDay());

                let lunarStart, lunarEnd, springFestivalDate;
                if (now < curFestivalDate) {
                    const prevYearFestival = Lunar.fromYmd(todayLunar.getYear() - 1, 1, 1).getSolar();
                    lunarStart = new Date(prevYearFestival.getYear(), prevYearFestival.getMonth() - 1, prevYearFestival.getDay());
                    lunarEnd = curFestivalDate;
                    springFestivalDate = curFestivalDate;
                } else {
                    lunarStart = curFestivalDate;
                    lunarEnd = nextFestivalDate;
                    springFestivalDate = nextFestivalDate;
                }

                const daysToSpring = daysLeft(springFestivalDate);
                const springPct = clamp01((now - lunarStart) / (springFestivalDate - lunarStart)) * 100;
                html += `
                    <div class="time-progress-row">
                        <span class="tp-label">春节</span>
                        <div class="tp-bar"><div style="width:${springPct.toFixed(1)}%"></div></div>
                        <span class="tp-pct">${Math.floor(springPct)}%</span>
                        <span class="tp-left">${daysToSpring > 0 ? '剩 ' + daysToSpring + ' 天' : '今天!'}</span>
                    </div>`;
            } catch(e) { /* 计算异常时静默降级 */ }
        }

        el.innerHTML = html;
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
            ${tasks.map(t => `<div class="focus-task-item ${this.focusTask?.id === t.id ? 'selected' : ''}" data-focus-task="${t.id}" role="button" tabindex="0">
                <div class="focus-task-priority priority-${t.priority}"></div>
                <div class="focus-task-content"><div class="focus-task-title">${esc(t.title)}</div><div class="focus-task-status">${this.statusLabel(t.status)}</div></div>
            </div>`).join('')}</div>`
            : '<p style="opacity:.6;font-size:.9rem">暂无可用任务</p>';
        list.onclick = e => {
            const item = e.target.closest('[data-focus-task]');
            if (item) this.selectFocusTask(+item.dataset.focusTask);
        };
        list.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') {
                const item = e.target.closest('[data-focus-task]');
                if (item) { e.preventDefault(); this.selectFocusTask(+item.dataset.focusTask); }
            }
        };
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
                <div class="habit-check ${h.completed ? 'completed' : ''}" data-toggle-habit="${esc(h.id)}" role="checkbox" aria-checked="${h.completed}" tabindex="0">${h.completed ? '<i class="fas fa-check"></i>' : ''}</div>
            </div>`).join('')
            : '<p class="empty-state">还没有添加习惯，点击上方"添加习惯"按钮开始吧！</p>';
        grid.onclick = e => {
            const check = e.target.closest('[data-toggle-habit]');
            if (check) this.toggleHabit(check.dataset.toggleHabit);
        };
        grid.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') {
                const check = e.target.closest('[data-toggle-habit]');
                if (check) { e.preventDefault(); this.toggleHabit(check.dataset.toggleHabit); }
            }
        };
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
            <div class="note-entry" data-note-id="${n.id}">
                <div class="note-entry-header"><span class="note-entry-timestamp">${esc(new Date(n.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))}</span>
                <button class="note-entry-delete-btn" data-del-note="${n.id}" aria-label="删除笔记"><i class="fas fa-times"></i></button></div>
                <div class="note-entry-content">${esc(n.content).replace(/\n/g, '<br>')}</div>
            </div>`).join('')
            : '<p class="empty-notes-placeholder">还没有笔记，快写下你的想法吧！</p>';
        c.onclick = e => {
            const delBtn = e.target.closest('[data-del-note]');
            if (delBtn) this.delNote(+delBtn.dataset.delNote);
        };
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
                if (!data.dailyData || typeof data.dailyData !== 'object') throw new Error('无效的数据格式：缺少 dailyData');
                for (const [date, dd] of Object.entries(data.dailyData)) {
                    if (dd.tasks !== undefined && !Array.isArray(dd.tasks)) throw new Error(`日期 ${date} 的 tasks 必须是数组`);
                    if (dd.notes !== undefined && !Array.isArray(dd.notes) && typeof dd.notes !== 'string') throw new Error(`日期 ${date} 的 notes 格式无效`);
                }
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
        n.setAttribute('role', 'alert');
        n.setAttribute('aria-live', 'assertive');
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

    // ---------- 统计页（dashboard.html） ----------
    renderDashboard() {
        const dailyData = JSON.parse(localStorage.getItem('dailyData')) || {};
        const globalHabits = JSON.parse(localStorage.getItem('globalHabits')) || [];
        if (Object.keys(dailyData).length === 0) {
            document.getElementById('statsGridContainer').innerHTML =
                '<p style="text-align:center;grid-column:1/-1;padding:2rem;color:var(--text-secondary)">暂无数据可供分析。请先在主页使用各项功能并记录数据。</p>';
            return;
        }
        const past = n => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return d.toISOString().split('T')[0]; });

        // ---------- 图表主题：与站点 indigo 设计语言统一 ----------
        const C = { indigo: '#4f46e5', indigoLight: '#8b85ff', info: '#0ea5e9', success: '#10b981', warning: '#f59e0b', danger: '#dc2626', muted: '#e5e7eb' };
        const soft = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
        Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
        Chart.defaults.font.size = 12;
        Chart.defaults.color = '#5f6570';
        Chart.defaults.plugins.legend.position = 'bottom';
        Object.assign(Chart.defaults.plugins.legend.labels, { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 14 });
        Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: 'rgba(31,41,55,.95)', padding: 10, cornerRadius: 8, boxPadding: 4, titleMarginBottom: 6 });
        const opts = extra => ({ responsive: true, maintainAspectRatio: false, ...extra });
        const yScales = (yMax, yStep) => ({
            x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
            y: { beginAtZero: true, max: yMax, grid: { color: 'rgba(17,24,39,.06)' }, border: { display: false }, ticks: yStep ? { stepSize: yStep } : {} },
        });
        // 环形图中心文字（完成率）
        const centerText = {
            id: 'centerText',
            afterDraw(chart) {
                const cfg = chart.config.options.plugins?.centerText;
                if (!cfg) return;
                const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                if (!total) return;
                const { x, y } = chart.getDatasetMeta(0).data[0];
                const ctx = chart.ctx;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.fillStyle = '#1f2937';
                ctx.font = '700 24px Inter, sans-serif';
                ctx.fillText(Math.round(cfg.value / total * 100) + '%', x, y + 8);
                ctx.font = '500 11px Inter, sans-serif';
                ctx.fillStyle = '#6b7280';
                ctx.fillText('完成率', x, y + 26);
                ctx.restore();
            },
        };

        // 任务统计：过去7天完成率 + 优先级分布
        {
            const days = past(7);
            let total = 0, done = 0;
            const pri = { high: 0, medium: 0, low: 0 };
            days.forEach(d => (dailyData[d]?.tasks || []).forEach(t => { total++; if (t.status === 'done') done++; if (pri[t.priority] !== undefined) pri[t.priority]++; }));
            if (!total) {
                document.getElementById('taskCompletionChart').parentElement.innerHTML = '<p class="empty-hint">过去7天还没有任务记录。</p>';
                document.getElementById('taskPriorityChart').parentElement.innerHTML = '<p class="empty-hint">过去7天还没有任务记录。</p>';
            } else {
                new Chart(document.getElementById('taskCompletionChart'), {
                    type: 'doughnut',
                    data: { labels: ['已完成', '未完成'], datasets: [{ data: [done, total - done], backgroundColor: [C.indigo, C.muted], borderWidth: 0, hoverOffset: 6 }] },
                    options: opts({ cutout: '68%', plugins: { centerText: { value: done } } }),
                    plugins: [centerText],
                });
                new Chart(document.getElementById('taskPriorityChart'), {
                    type: 'doughnut',
                    data: { labels: ['高', '中', '低'], datasets: [{ data: [pri.high, pri.medium, pri.low], backgroundColor: [C.danger, C.warning, C.success], borderWidth: 0, hoverOffset: 6 }] },
                    options: opts({ cutout: '60%' }),
                });
            }
        }

        // 番茄钟统计：过去30天趋势
        {
            const days = past(30);
            const counts = days.map(d => (dailyData[d]?.pomodoroSessions || []).filter(s => s.type === 'work').length);
            const total = counts.reduce((a, b) => a + b, 0);
            new Chart(document.getElementById('pomodoroTrendChart'), {
                type: 'line',
                data: { labels: days.map(d => d.slice(5)), datasets: [{ label: '每日完成番茄钟数量', data: counts, borderColor: C.indigo, backgroundColor: soft(C.indigo, .12), fill: true, tension: .4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }] },
                options: opts({ interaction: { mode: 'index', intersect: false }, scales: yScales() }),
            });
            document.getElementById('pomodoroSummary').innerHTML = `<p style="font-size:.95rem;color:var(--text-secondary)">过去30天总计完成 <strong>${total}</strong> 个番茄钟。</p>`;
        }

        // 番茄钟时段分布：按小时 + 按星期
        {
            const hourly = Array(24).fill(0), daily = Array(7).fill(0);
            let total = 0;
            Object.keys(dailyData).sort().slice(-30).forEach(d => (dailyData[d]?.pomodoroSessions || []).forEach(s => {
                if (s.type === 'work') { const t = new Date(s.startTime); hourly[t.getHours()]++; daily[t.getDay()]++; total++; }
            }));
            if (total === 0) {
                document.getElementById('pomodoroDistributionChartHour').parentElement.innerHTML = '<p class="empty-hint">过去30天内没有番茄钟记录。</p>';
            } else {
                new Chart(document.getElementById('pomodoroDistributionChartHour'), {
                    type: 'bar',
                    data: { labels: Array.from({ length: 24 }, (_, i) => `${i}时`), datasets: [{ label: '番茄钟数量', data: hourly, backgroundColor: C.indigo, borderRadius: 3, maxBarThickness: 14 }] },
                    options: opts({ plugins: { legend: { display: false } }, scales: yScales() }),
                });
                new Chart(document.getElementById('pomodoroDistributionChartDay'), {
                    type: 'bar',
                    data: { labels: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'], datasets: [{ label: '番茄钟数量', data: daily, backgroundColor: C.indigoLight, borderRadius: 3, maxBarThickness: 22 }] },
                    options: opts({ plugins: { legend: { display: false } }, scales: yScales(undefined, 1) }),
                });
            }
        }

        // 习惯追踪：过去30天完成率 + 热力图
        {
            const box = document.getElementById('habitCompletionHeatmap');
            const days = past(30);
            if (!globalHabits.length) { box.innerHTML = '<p class="empty-hint">尚未添加任何习惯。请先在主页添加习惯。</p>'; }
            else {
                box.innerHTML = globalHabits.map(h => {
                    const statuses = days.map(d => {
                        const rec = (dailyData[d]?.habits || []).find(x => x.name === h.name);
                        return { d, ok: !!rec?.completed };
                    });
                    const done = statuses.filter(x => x.ok).length;
                    let streak = 0, max = 0;
                    statuses.forEach(s => { if (s.ok) streak++; else { max = Math.max(max, streak); streak = 0; } });
                    max = Math.max(max, streak);
                    return `<div class="habit-row"><strong>${esc(h.name)}</strong><div class="habit-legend">过去30天完成率: ${(done / 30 * 100).toFixed(1)}% (最长连续: ${max}天)</div>
                        <div class="heatmap-days">${statuses.map(s => `<span class="heatmap-day ${s.ok ? 'completed' : ''}" title="${s.d} ${s.ok ? '已完成' : '未完成'}"></span>`).join('')}</div></div>`;
                }).join('');
            }
        }

        // 笔记创建趋势：过去30天
        {
            const days = past(30);
            const counts = days.map(d => (dailyData[d]?.notes || []).length);
            if (counts.every(c => c === 0)) {
                document.getElementById('notesTrendChart').parentElement.innerHTML = '<p class="empty-hint">过去30天内没有笔记记录。</p>';
            } else {
                new Chart(document.getElementById('notesTrendChart'), {
                    type: 'line',
                    data: { labels: days.map(d => d.slice(5)), datasets: [{ label: '每日创建笔记数量', data: counts, borderColor: C.info, backgroundColor: soft(C.info, .12), fill: true, tension: .4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 }] },
                    options: opts({ interaction: { mode: 'index', intersect: false }, scales: yScales(undefined, 1) }),
                });
            }
        }

        // 任务标签分析：过去30天 Top10
        {
            const tagCounts = {};
            Object.keys(dailyData).sort().slice(-30).forEach(d => (dailyData[d]?.tasks || []).forEach(t => (t.tags || []).forEach(x => tagCounts[x] = (tagCounts[x] || 0) + 1)));
            const entries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
            if (!entries.length) {
                document.getElementById('taskTagsChart').parentElement.innerHTML = '<p class="empty-hint">过去30天内没有带标签的任务。</p>';
            } else {
                new Chart(document.getElementById('taskTagsChart'), {
                    type: 'bar',
                    data: { labels: entries.map(e => e[0]), datasets: [{ label: '任务数量', data: entries.map(e => e[1]), backgroundColor: C.indigo, borderRadius: 3, maxBarThickness: 12 }] },
                    options: opts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(17,24,39,.06)' } }, y: { grid: { display: false }, border: { display: false } } } }),
                });
            }
        }

        // 平均任务耗时：过去30天完成的任务
        {
            const times = [];
            past(30).forEach(d => (dailyData[d]?.tasks || []).forEach(t => {
                if (t.status === 'done' && t.createdAt && t.completedAt) {
                    const diff = new Date(t.completedAt) - new Date(t.createdAt);
                    if (diff > 0) times.push(diff);
                }
            }));
            const el = document.getElementById('avgTaskCompletionTimeDisplay');
            if (!times.length) { el.innerHTML = '<p style="font-size:.95rem;color:var(--text-light)">无已完成任务数据</p>'; }
            else {
                const h = times.reduce((a, b) => a + b, 0) / times.length / 3600000;
                el.innerHTML = h < 1 ? `${(h * 60).toFixed(1)} 分钟` : h < 48 ? `${h.toFixed(1)} 小时` : `${(h / 24).toFixed(1)} 天`;
                el.insertAdjacentHTML('beforeend', '<p style="font-size:.78rem;color:var(--text-light);margin-top:.5rem">(基于过去30天内完成的任务)</p>');
            }
        }
    }

    // ---------- 日历页（calendar.html） ----------
    renderCalendar() {
        const calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
            initialView: 'dayGridMonth',
            locale: 'zh-cn',
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' },
            editable: true,
            events: (info, success) => {
                const dailyData = JSON.parse(localStorage.getItem('dailyData')) || {};
                const events = [];
                for (const date in dailyData) {
                    (dailyData[date].tasks || []).forEach(task => {
                        if (!task.deadline) return;
                        let bg = 'var(--primary-color)', text = '#fff';
                        if (task.status === 'done') bg = 'var(--success)';
                        else if (task.priority === 'high') bg = 'var(--error)';
                        else if (task.priority === 'medium') { bg = 'var(--warning)'; text = 'var(--text-primary)'; }
                        else if (task.priority === 'low') bg = 'var(--info)';
                        const allDay = !task.startTime;
                        events.push({
                            id: String(task.id), title: task.title,
                            start: allDay ? task.deadline : `${task.deadline}T${task.startTime}`,
                            end: task.endTime ? `${task.deadline}T${task.endTime}` : null,
                            allDay, backgroundColor: bg, borderColor: bg, textColor: text,
                            extendedProps: { description: task.description, priority: task.priority, status: task.status }
                        });
                    });
                }
                success(events);
            },
            eventClick: info => {
                const p = info.event.extendedProps;
                const priLabel = { high: '高', medium: '中', low: '低' }[p.priority] || '—';
                const statusLabel = { todo: '待办', 'in-progress': '进行中', done: '已完成' }[p.status] || '—';
                document.getElementById('evtTitle').textContent = info.event.title;
                document.getElementById('evtBody').innerHTML = `
                    <div class="evt-meta"><span>优先级</span><strong>${priLabel}</strong></div>
                    <div class="evt-meta"><span>状态</span><strong>${statusLabel}</strong></div>
                    <div class="evt-meta"><span>描述</span><strong>${esc(p.description || '无')}</strong></div>`;
                document.getElementById('eventDetailModal').classList.add('active');
            },
            eventDrop: info => {
                const start = info.event.start;
                if (!start) { info.revert(); return this.notify('更新任务时间失败', 'error'); }
                const newDate = start.toISOString().split('T')[0];
                const newStart = (!info.event.allDay && start.toISOString().includes('T')) ? start.toISOString().split('T')[1].substring(0, 5) : null;
                if (this.updateTaskDateTime) this.updateTaskDateTime(info.event.id, newDate, newStart, info.event.allDay);
                else info.revert();
            }
        });
        calendar.render();

        const setAria = (sel, label) => { const el = document.querySelector(sel); if (el) el.setAttribute('aria-label', label); };
        setTimeout(() => {
            setAria('.fc-prev-button', '上一月');
            setAria('.fc-next-button', '下一月');
            setAria('.fc-today-button', '今天');
        }, 100);

        window.addEventListener('storage', e => { if (e.key === 'dailyData') calendar.refetchEvents(); });
        this.calendar = calendar;
    }
}

// 脚本在 body 底部，DOM 已就绪：立即构造，消除计时器恢复前的静态闪烁
let app = new App();
window.app = app;
