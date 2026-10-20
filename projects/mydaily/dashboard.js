// MyDaily 统计页 —— 数据全部来自 localStorage，Chart.js 渲染
document.addEventListener('DOMContentLoaded', () => {
    const dailyData = JSON.parse(localStorage.getItem('dailyData')) || {};
    const globalHabits = JSON.parse(localStorage.getItem('globalHabits')) || [];
    if (Object.keys(dailyData).length === 0) {
        document.getElementById('statsGridContainer').innerHTML =
            '<p style="text-align:center;grid-column:1/-1;padding:2rem;color:var(--text-secondary)">暂无数据可供分析。请先在主页使用各项功能并记录数据。</p>';
        return;
    }
    const past = n => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return d.toISOString().split('T')[0]; });
    const dayCount = (date, fn) => { const dd = dailyData[date]; return dd ? (dd[fn] || []).length : 0; };

    // ---------- 图表主题：与站点 indigo 设计语言统一 ----------
    const C = { indigo: '#4f46e5', indigoLight: '#8b85ff', info: '#0ea5e9', success: '#10b981', danger: '#dc2626', muted: '#e5e7eb' };
    const soft = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#6b7280';
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
        Object.keys(dailyData).sort().slice(-30).forEach(d => (dailyData[d].pomodoroSessions || []).forEach(s => {
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
        Object.keys(dailyData).sort().slice(-30).forEach(d => (dailyData[d].tasks || []).forEach(t => (t.tags || []).forEach(x => tagCounts[x] = (tagCounts[x] || 0) + 1)));
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
});

