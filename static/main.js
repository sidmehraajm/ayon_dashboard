// --- AYON CONFIGURATION ---
const AYON_BASE_URL = "http://ayon:5000"; // Ensure this matches your local network setup

let gridApi = null;
let chartInstance = null;
let overviewPieInstance = null;
let lifecycleLineInstance = null;
let globalRawTrackingData = {}; 
let allProjects = [];

// Global states for Artist filtering
let currentArtistData = {};
let filteredModalData = {}; 
let currentProjectStatuses = []; 

document.addEventListener("DOMContentLoaded", async () => {
    await loadProjects();
    
    // FIXED: Bulletproof Asset Typing Search
    document.getElementById('asset-search').addEventListener('input', async (e) => {
        if (gridApi) {
            const filterInstance = await gridApi.getColumnFilterInstance('assetName');
            if (filterInstance) {
                const val = e.target.value.trim();
                filterInstance.setModel(val === '' ? null : { type: 'contains', filter: val });
                gridApi.onFilterChanged();
            }
        }
    });

    // Advanced Artist Filters
    document.getElementById('artist-selector').addEventListener('change', applyArtistFilters);
    document.getElementById('artist-asset-filter').addEventListener('change', applyArtistFilters);
    document.getElementById('artist-status-filter').addEventListener('change', applyArtistFilters);
    
    // Close Custom Dropdown on Outside Click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            document.querySelectorAll('.dropdown-content').forEach(el => el.classList.remove('show'));
        }
    });
});

function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).style.display = 'block';
    event.target.classList.add('active');
    // Lazy-load planner on first visit
    if (tabId === 'planner' && ganttState.assets.length === 0) {
        const sel = document.getElementById('planner-project-selector');
        if (sel && sel.value) loadPlannerData(sel.value);
    }
}

// Generates direct deep links to the Ayon Web Interface
function generateAyonLink(projectName, folderId, taskId) {
    if (!folderId || !taskId) return "#";
    return `${AYON_BASE_URL}/projects/${projectName}/browser?folder=${folderId}&task=${taskId}`;
}

async function loadProjects() {
    try {
        const response = await fetch("/api/projects");
        allProjects = await response.json();
        
        const assetSelector = document.getElementById("asset-project-selector");
        const artistSelector = document.getElementById("artist-project-selector");
        const dailySelector = document.getElementById("daily-project-selector");
        const overviewSelector = document.getElementById("overview-project-selector");
        const lifecycleSelector = document.getElementById("lifecycle-project-selector");
        
        let assetHtml = "";
        let globalHtml = `<option value="ALL" selected>-- ALL PROJECTS --</option>`;
        
        allProjects.forEach(proj => {
            const opt = `<option value="${proj}">${proj}</option>`;
            assetHtml += opt;
            globalHtml += opt;
        });

        assetSelector.innerHTML = assetHtml;
        artistSelector.innerHTML = globalHtml;
        dailySelector.innerHTML = globalHtml;
        if (overviewSelector) overviewSelector.innerHTML = assetHtml;
        if (lifecycleSelector) lifecycleSelector.innerHTML = assetHtml;

        const plannerSelector = document.getElementById('planner-project-selector');
        if (plannerSelector) plannerSelector.innerHTML = assetHtml;

        if (allProjects.length > 0) {
            loadTrackingData(allProjects[0]);
            assetSelector.addEventListener("change", (e) => loadTrackingData(e.target.value));
            
            if (overviewSelector) {
                overviewSelector.addEventListener("change", (e) => loadOverviewData(e.target.value));
                loadOverviewData(allProjects[0]);
            }
            if (lifecycleSelector) {
                lifecycleSelector.addEventListener("change", (e) => loadLifecycleAssets(e.target.value));
                document.getElementById("lifecycle-asset-selector").addEventListener("change", (e) => loadLifecycleChart(lifecycleSelector.value, e.target.value));
                loadLifecycleAssets(allProjects[0]);
            }
            if (plannerSelector) {
                plannerSelector.addEventListener("change", (e) => loadPlannerData(e.target.value));
            }
        }
    } catch (error) {
        console.error("Failed to load projects", error);
    }
}

// ==========================================
// ASSET TRACKING (Master-Detail Grid)
// ==========================================
let currentTrackingStatuses = []; // Store official project statuses

async function loadTrackingData(projectName) {
    document.getElementById("project-health-summary").innerText = "Establishing secure connection...";
    try {
        const response = await fetch(`/api/metrics/tracking/${projectName}`);
        const payload = await response.json();
        
        globalRawTrackingData = payload.tracking_data;
        currentTrackingStatuses = payload.all_statuses; // The official statuses from Ayon
        
        populateAssetSearchDropdown();
        buildStatusCheckboxes(); 
    } catch (error) { console.error("Tracking Data Error:", error); }
}

function populateAssetSearchDropdown() {
    const dataList = document.getElementById("asset-list");
    let optionsHtml = "";
    Object.values(globalRawTrackingData).forEach(folder => {
        optionsHtml += `<option value="${folder.name}">`;
    });
    dataList.innerHTML = optionsHtml;
}

function toggleStatusDropdown() { document.getElementById('status-checkboxes').classList.toggle('show'); }

function buildStatusCheckboxes() {
    const container = document.getElementById('status-checkboxes');
    const bulkSelect = document.getElementById('bulk-status-select');
    const deliverySelect = document.getElementById('delivery-status-selector');
    
    let containerHtml = "";
    let bulkSelectHtml = '<option value="">-- Do Not Change Status --</option>';
    let deliverySelectHtml = '<option value="">-- Use Target Criteria --</option>';
    let overviewHtml = "";
    
    const overviewExcluded = ['not ready', 'on hold', 'remove', 'omitted'];

    // Build the lists using the OFFICIAL statuses from the schema
    currentTrackingStatuses.forEach(status => {
        const s = status.toLowerCase();
        const isChecked = s.includes('approve') || s.includes('final') || s.includes('done') || s.includes('deliver') ? 'checked' : '';
        const overviewChecked = overviewExcluded.includes(s) ? '' : 'checked';
        
        containerHtml += `<label class="dropdown-item"><input type="checkbox" value="${status}" ${isChecked} onchange="recalculateHealth()"> ${status}</label>`;
        bulkSelectHtml += `<option value="${status}">${status}</option>`;
        deliverySelectHtml += `<option value="${status}">${status}</option>`;
        overviewHtml += `<label class="dropdown-item"><input type="checkbox" value="${status}" ${overviewChecked} onchange="recalculateOverviewPieChart()"> ${status}</label>`;
    });
    
    container.innerHTML = containerHtml;
    if (bulkSelect) bulkSelect.innerHTML = bulkSelectHtml;
    if (deliverySelect) deliverySelect.innerHTML = deliverySelectHtml;
    
    const overviewContainer = document.getElementById('overview-status-checkboxes');
    if (overviewContainer) overviewContainer.innerHTML = overviewHtml;
    
    recalculateHealth();
    recalculateOverviewPieChart();
}

function getSelectedStatuses() {
    return Array.from(document.querySelectorAll('#status-checkboxes input:checked')).map(cb => cb.value.toLowerCase());
}

function calculateDelay(endDateStr, updatedAtStr, isDelivered) {
    if (!endDateStr) return { text: "N/A", color: "" };
    
    if (!isDelivered) {
        const diffTime = Date.now() - new Date(endDateStr);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 0) return { text: `${diffDays} Days Late (Pending)`, color: "#ef4444" };
        else return { text: "Pending", color: "" };
    }
    
    if (!updatedAtStr) return { text: "Delivered", color: "#10b981" };
    
    const diffTime = new Date(updatedAtStr) - new Date(endDateStr);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return { text: "On Time", color: "#10b981" };
    return { text: `${diffDays} Days Late`, color: "#f59e0b" };
}

function recalculateHealth() {
    const completedStatuses = getSelectedStatuses();
    const referenceStatusSelect = document.getElementById('delivery-status-selector');
    const referenceStatus = referenceStatusSelect ? referenceStatusSelect.value.toLowerCase() : "";
    
    const rowData = [];
    let totalTasksGlobal = 0;
    let completedTasksGlobal = 0;

    Object.values(globalRawTrackingData).forEach(folder => {
        const totalTasks = folder.tasks ? folder.tasks.length : 0;
        let completedTasks = 0;

        if (folder.tasks) {
            folder.tasks.forEach(task => {
                const taskStatus = task.status.toLowerCase();
                if (completedStatuses.includes(taskStatus)) completedTasks++;
                
                let isDelivered = false;
                if (referenceStatus !== "") {
                    // Use exclusively the selected reference status, OR if it's already in the completed criteria
                    isDelivered = (taskStatus === referenceStatus) || completedStatuses.includes(taskStatus);
                } else {
                    isDelivered = completedStatuses.includes(taskStatus);
                }
                
                const delayData = calculateDelay(task.end_date, task.updated_at, isDelivered);
                task.delay_text = delayData.text;
                task.delay_color = delayData.color;
            });
        }

        const health = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        totalTasksGlobal += totalTasks;
        completedTasksGlobal += completedTasks;

        rowData.push({ assetName: folder.name, assetType: folder.type, health: health, tasks: folder.tasks || [] });
    });

    const globalHealth = totalTasksGlobal > 0 ? Math.round((completedTasksGlobal / totalTasksGlobal) * 100) : 0;
    document.getElementById("project-health-summary").innerHTML = `Global Project Completion: <span style="color: var(--accent-green);">${globalHealth}%</span>`;
    renderMasterDetailGrid(rowData);
}

function generateAyonLink(projectName, folderId) {
    return `http://ayon:5000/projects/${projectName}/overview?project=${projectName}&type=folder&id=${folderId}`;
}

let currentPieStatusManifest = {};

function recalculateOverviewPieChart() {
    const overviewContainer = document.getElementById('overview-status-checkboxes');
    if (!overviewContainer) return;
    
    currentPieStatusManifest = {};
    const includedStatuses = Array.from(overviewContainer.querySelectorAll('input:checked')).map(cb => cb.value.toLowerCase());
    const statusCounts = {};
    includedStatuses.forEach(s => statusCounts[s] = 0);
    
    Object.values(globalRawTrackingData).forEach(folder => {
        if (folder.tasks) {
            folder.tasks.forEach(task => {
                const s = task.status.toLowerCase();
                if (statusCounts[s] !== undefined) {
                    statusCounts[s]++;
                    if (!currentPieStatusManifest[s]) currentPieStatusManifest[s] = [];
                    currentPieStatusManifest[s].push({
                        assetName: folder.name,
                        assetPath: folder.path,
                        taskName: task.task_name,
                        folderId: folder.asset_id
                    });
                }
            });
        }
    });
    
    const labels = [];
    const data = [];
    const bgColors = [];
    const materialColors = ['#1aa192', '#099c6b', '#9b5050', '#7a7990', '#42a5f5', '#ffa726', '#ab47bc', '#ec407a', '#26c6da', '#d4e157', '#66bb6a', '#ffca28'];
    
    Object.keys(statusCounts).forEach((s, i) => {
        if (statusCounts[s] > 0) {
            labels.push(s.toUpperCase());
            data.push(statusCounts[s]);
            bgColors.push(materialColors[i % materialColors.length]);
        }
    });
    
    renderOverviewPieChartDynamic(labels, data, bgColors);
}

function renderMasterDetailGrid(rowData) {
    const gridDiv = document.querySelector('#trackingGrid');
    if (gridApi) { gridApi.setGridOption('rowData', rowData); return; }

    const activeProject = document.getElementById("asset-project-selector").value;

    const gridOptions = {
        rowData: rowData,
        theme: "ag-theme-alpine-dark",
        masterDetail: true,
        detailRowAutoHeight: true,
        rowSelection: 'multiple', // ENABLE MASTER ROW SELECTION (ASSETS)
        onSelectionChanged: handleTaskSelection, // Listener for Asset Selection
        detailCellRendererParams: {
            detailGridOptions: {
                rowSelection: 'multiple', 
                onSelectionChanged: handleTaskSelection, // Listener for Task Selection
                columnDefs: [
                    { field: 'task_name', headerName: 'Task Name', flex: 1.5, checkboxSelection: true, headerCheckboxSelection: true },
                    { field: 'assignees', valueFormatter: p => p.value && p.value.length > 0 ? p.value.join(', ') : 'Unassigned', flex: 1 },
                    { 
                        field: 'status', flex: 1,
                        cellRenderer: params => {
                            const val = params.value ? params.value.toLowerCase() : '';
                            if (val.includes('approve') || val.includes('final')) return `<span class="status-pill pill-green">${params.value}</span>`;
                            if (val.includes('progress') || val.includes('wip')) return `<span class="status-pill pill-yellow">${params.value}</span>`;
                            return `<span class="status-pill" style="border: 1px solid var(--panel-border)">${params.value}</span>`;
                        }
                    },
                    { field: 'end_date', headerName: 'Target Date', valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : 'N/A', flex: 1 },
                    { field: 'delay_text', headerName: 'Delivery', flex: 1, cellStyle: params => ({ color: params.data.delay_color, fontWeight: 'bold' }) },
                    {
                        headerName: 'Action', flex: 0.5,
                        cellRenderer: params => {
                            const link = generateAyonLink(activeProject, params.data.folder_id);
                            return `<a href="${link}" target="_blank" class="ayon-link">Open ↗</a>`;
                        }
                    }
                ],
                theme: "ag-theme-alpine-dark",
            },
            getDetailRowData: params => params.successCallback(params.data.tasks)
        },
        columnDefs: [
            { 
                field: "assetName", 
                headerName: "Asset Name", 
                cellRenderer: 'agGroupCellRenderer', 
                flex: 2,
                checkboxSelection: true, // ADDS CHECKBOX TO THE PARENT ASSET
                headerCheckboxSelection: true 
            },
            { field: "assetType", headerName: "Type", flex: 1 },
            { 
                field: "health", headerName: "Completion Status", flex: 1, valueFormatter: p => p.value + "%",
                cellStyle: params => {
                    if (params.value === 100) return { color: 'var(--accent-green)', fontWeight: 'bold' };
                    if (params.value > 0) return { color: 'var(--accent-blue)' };
                    return { color: 'var(--text-secondary)' }; 
                }
            }
        ],
        defaultColDef: { sortable: true, filter: true }
    };
    gridApi = agGrid.createGrid(gridDiv, gridOptions);
}

// ==========================================
// BULK EDITING LOGIC
// ==========================================
function handleTaskSelection() {
    let selectedTasks = new Set();
    
    // 1. Gather all tasks from selected Parent Assets
    if (gridApi) {
        const selectedAssets = gridApi.getSelectedRows();
        selectedAssets.forEach(asset => {
            if (asset.tasks) {
                asset.tasks.forEach(t => selectedTasks.add(t.task_id));
            }
        });
        
        // 2. Gather any individually selected Tasks inside expanded rows
        gridApi.forEachDetailGridInfo(function(detailGridInfo) {
            const selectedChildRows = detailGridInfo.api.getSelectedRows();
            selectedChildRows.forEach(t => selectedTasks.add(t.task_id));
        });
    }

    const selectedCount = selectedTasks.size;
    const actionBar = document.getElementById('bulk-action-bar');
    
    if (actionBar) {
        if (selectedCount > 0) {
            document.getElementById('selected-task-count').innerText = selectedCount;
            actionBar.style.display = 'flex';
        } else {
            actionBar.style.display = 'none';
        }
    }
}

function clearSelection() {
    if (gridApi) {
        gridApi.deselectAll(); // Deselect Parent Assets
        gridApi.forEachDetailGridInfo(function(detailGridInfo) {
            detailGridInfo.api.deselectAll(); // Deselect Child Tasks
        });
    }
    document.getElementById('bulk-status-select').value = "";
    document.getElementById('bulk-date-select').value = "";
    handleTaskSelection(); 
}

async function executeBulkUpdate() {
    const newStatus = document.getElementById('bulk-status-select').value;
    const newDate = document.getElementById('bulk-date-select').value;
    const activeProject = document.getElementById("asset-project-selector").value;

    if (!newStatus && !newDate) {
        alert("Please select a new status or date to apply.");
        return;
    }

    let tasksToUpdateMap = new Map();
    
    // Harvest from Parent Assets
    gridApi.getSelectedRows().forEach(asset => {
        if (asset.tasks) {
            asset.tasks.forEach(task => {
                tasksToUpdateMap.set(task.task_id, {
                    task_id: task.task_id, status: newStatus || null, end_date: newDate || null
                });
            });
        }
    });

    // Harvest from Individual Task Rows
    gridApi.forEachDetailGridInfo(function(detailGridInfo) {
        const selectedRows = detailGridInfo.api.getSelectedRows();
        selectedRows.forEach(task => {
            tasksToUpdateMap.set(task.task_id, {
                task_id: task.task_id, status: newStatus || null, end_date: newDate || null
            });
        });
    });

    const tasksToUpdate = Array.from(tasksToUpdateMap.values());
    if (tasksToUpdate.length === 0) return;

    document.getElementById("project-health-summary").innerText = "Pushing batch updates to Ayon...";
    
    try {
        const response = await fetch("/api/metrics/bulk_update", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_name: activeProject, updates: tasksToUpdate })
        });

        if (response.ok) {
            clearSelection();
            await loadTrackingData(activeProject); 
        } else {
            throw new Error("Server rejected the update.");
        }
    } catch (error) {
        console.error("Bulk Update Failed:", error);
        alert("Failed to push updates.");
        document.getElementById("project-health-summary").innerText = "Update Failed.";
    }
}

// ==========================================
// ARTIST ANALYTICS, FILTERING & MODAL
// ==========================================
async function loadArtistData() {
    const selector = document.getElementById("artist-project-selector");
    let selectedProjects = Array.from(selector.selectedOptions).map(opt => opt.value);
    
    if (selectedProjects.includes("ALL")) selectedProjects = allProjects;

    try {
        const response = await fetch("/api/metrics/artists", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projects: selectedProjects })
        });
        
        const payload = await response.json();
        
        currentArtistData = payload.artists;
        currentProjectStatuses = payload.all_statuses;
        
        populateArtistDropdowns();
        applyArtistFilters();
    } catch (error) { console.error("Artist Data Error:", error); }
}

function populateArtistDropdowns() {
    const artistDropdown = document.getElementById("artist-selector");
    const assetDropdown = document.getElementById("artist-asset-filter");
    const statusDropdown = document.getElementById("artist-status-filter");

    const uniqueAssets = new Set();
    
    let artistHtml = `<option value="ALL">-- Global View --</option>`;
    Object.keys(currentArtistData).sort().forEach(artist => {
        artistHtml += `<option value="${artist}">${artist}</option>`;
        currentArtistData[artist].publishes.forEach(pub => {
            if (pub.asset_path) uniqueAssets.add(pub.asset_path);
        });
    });
    artistDropdown.innerHTML = artistHtml;

    let assetHtml = `<option value="ALL">-- All Assets --</option>`;
    Array.from(uniqueAssets).sort().forEach(asset => {
        const shortName = asset.split('/').slice(-2).join('/');
        assetHtml += `<option value="${asset}">${shortName}</option>`;
    });
    assetDropdown.innerHTML = assetHtml;

    let statusHtml = `<option value="ALL">-- All Statuses --</option>`;
    currentProjectStatuses.forEach(status => {
        statusHtml += `<option value="${status}">${status}</option>`;
    });
    statusDropdown.innerHTML = statusHtml;
}

function applyArtistFilters() {
    const selectedArtist = document.getElementById("artist-selector").value;
    const selectedAsset = document.getElementById("artist-asset-filter").value;
    const selectedStatus = document.getElementById("artist-status-filter").value;

    const labels = [];
    const publishCounts = [];
    filteredModalData = {}; 

    Object.keys(currentArtistData).sort().forEach(artist => {
        if (selectedArtist !== "ALL" && artist !== selectedArtist) return;

        let validPublishes = currentArtistData[artist].publishes;

        if (selectedAsset !== "ALL") validPublishes = validPublishes.filter(p => p.asset_path === selectedAsset);
        if (selectedStatus !== "ALL") validPublishes = validPublishes.filter(p => p.status === selectedStatus);

        if (validPublishes.length > 0) {
            labels.push(artist);
            publishCounts.push(validPublishes.length);
            filteredModalData[artist] = validPublishes; 
        }
    });

    renderArtistChart(labels, publishCounts);
}

function renderArtistChart(labels, publishCounts) {
    const ctx = document.getElementById('artistChart').getContext('2d');

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Filtered Iterations', 
                data: publishCounts,
                backgroundColor: 'rgba(59, 130, 246, 0.8)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { 
                y: { beginAtZero: true, grid: { color: '#2d313f' }, ticks: { color: '#94a3b8' } }, 
                x: { grid: { display: false }, ticks: { color: '#e2e8f0' } } 
            },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(context) { return context.raw + ' Iterations'; } } } },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    openArtistModal(labels[index]);
                }
            }
        }
    });
}

function openArtistModal(artistName) {
    document.getElementById('modal-title').innerText = `${artistName} - Filtered Iterations`;
    const tbody = document.getElementById('modal-tbody');
    tbody.innerHTML = "";
    
    const publishes = filteredModalData[artistName] || [];
    
    if (publishes.length === 0) {
        tbody.innerHTML = "<tr><td colspan='7'>No iterations found matching current filters.</td></tr>";
    } else {
        let rowsHtml = "";
        publishes.forEach(pub => {
            const dateStr = pub.date ? new Date(pub.date).toLocaleString() : "N/A";
            const statusClass = pub.status.toLowerCase().includes('approve') ? 'pill-green' : 'pill-yellow';
            const ayonLink = generateAyonLink(pub.project, pub.folder_id);
            
            rowsHtml += `
                <tr>
                    <td>${pub.project}</td>
                    <td style="color: var(--text-secondary); font-family: monospace;">${pub.asset_path}</td>
                    <td>${pub.task}</td>
                    <td><span style="color: var(--accent-blue); font-weight: bold;">${pub.version}</span></td>
                    <td><span class="status-pill ${statusClass}">${pub.status}</span></td>
                    <td>${dateStr}</td>
                    <td><a href="${ayonLink}" target="_blank" class="ayon-link">Open ↗</a></td>
                </tr>
            `;
        });
        tbody.innerHTML = rowsHtml;
    }
    document.getElementById('artist-modal').style.display = 'flex';
}

function closeModal() { document.getElementById('artist-modal').style.display = 'none'; }

// ==========================================
// DAILY REPORT
// ==========================================
async function loadDailyReport() {
    const selector = document.getElementById("daily-project-selector");
    let selectedProjects = Array.from(selector.selectedOptions).map(opt => opt.value);
    if (selectedProjects.includes("ALL")) selectedProjects = allProjects;

    const container = document.getElementById("daily-report-container");
    container.innerHTML = "<h3 style='color: var(--text-secondary); text-align: center;'>Compiling Daily Telemetry...</h3>";

    try {
        const response = await fetch("/api/metrics/daily", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projects: selectedProjects })
        });
        
        const reportData = await response.json();
        container.innerHTML = "";

        if (Object.keys(reportData).length === 0) {
            container.innerHTML = "<h3 style='color: var(--text-secondary); text-align: center;'>No publishes detected in the last 24 hours.</h3>";
            return;
        }

        let containerHtml = "";
        Object.keys(reportData).forEach(project => {
            const projData = reportData[project];
            let rowsHtml = "";
            
            projData.publishes.forEach(pub => {
                const dateStr = pub.date ? new Date(pub.date).toLocaleTimeString() : "N/A";
                const statusClass = pub.status.toLowerCase().includes('approve') ? 'pill-green' : 'pill-yellow';
                const ayonLink = generateAyonLink(project, pub.folder_id);

                rowsHtml += `
                    <tr>
                        <td><strong>${pub.author}</strong></td>
                        <td style="font-family: monospace; color: var(--text-secondary);">${pub.asset_path}</td>
                        <td>${pub.task}</td>
                        <td style="color: var(--accent-blue); font-weight: bold;">${pub.version}</td>
                        <td><span class="status-pill ${statusClass}">${pub.status}</span></td>
                        <td>${dateStr}</td>
                        <td><a href="${ayonLink}" target="_blank" class="ayon-link">View ↗</a></td>
                    </tr>
                `;
            });

            containerHtml += `
                <div class="project-report-card">
                    <div class="report-header">
                        <h3>${project}</h3>
                        <span class="publish-count">${projData.total_publishes} Publishes (Last 24h)</span>
                    </div>
                    <table class="premium-table">
                        <thead>
                            <tr>
                                <th>Artist</th>
                                <th>Asset Path</th>
                                <th>Task</th>
                                <th>Version</th>
                                <th>Status</th>
                                <th>Time</th>
                                <th>Link</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            `;
        });
        container.innerHTML = containerHtml;
    } catch (error) {
        console.error("Daily Report Error:", error);
        container.innerHTML = "<h3 style='color: var(--accent-red);'>Failed to load report.</h3>";
    }
}

// ==========================================
// PREMIER OVERVIEW & LIFECYCLE MODULES
// ==========================================
function renderOverviewPieChartDynamic(labels, data, bgColors) {
    const ctx = document.getElementById('overviewPieChart');
    if (!ctx) return;
    
    if (overviewPieInstance) overviewPieInstance.destroy();
    
    Chart.defaults.color = '#71627a';
    Chart.defaults.font.family = 'Inter';
    
    overviewPieInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{
                data: data.length ? data : [1],
                backgroundColor: data.length ? bgColors : ['#2e293a'],
                borderColor: 'transparent',
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true, boxWidth: 8 } },
                tooltip: { callbacks: { label: function(context) { return context.raw + ' Tasks'; } } }
            },
            onClick: (event, elements) => {
                if (elements.length > 0 && labels.length > 0 && labels[0] !== 'No Data') {
                    const index = elements[0].index;
                    const statusKey = labels[index].toLowerCase();
                    openPieChartDetails(statusKey, currentPieStatusManifest[statusKey] || []);
                }
            }
        }
    });
}

function openPieChartDetails(status, tasksArray) {
    document.getElementById('pie-modal-title').innerText = `Status: ${status.toUpperCase()}`;
    const tbody = document.getElementById('pie-modal-tbody');
    const activeProject = document.getElementById("asset-project-selector").value;
    
    if (tasksArray.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4'>No tasks found for this status.</td></tr>";
    } else {
        let rowsHtml = "";
        tasksArray.forEach(t => {
            const ayonLink = generateAyonLink(activeProject, t.folderId);
            rowsHtml += `
                <tr>
                    <td style="font-weight: 600; color: #fff;">${t.assetName}</td>
                    <td style="font-family: monospace; color: var(--text-secondary);">${t.assetPath}</td>
                    <td style="color: var(--accent-blue); font-weight: 600;">${t.taskName}</td>
                    <td><a href="${ayonLink}" target="_blank" class="ayon-link">Inspect ↗</a></td>
                </tr>
            `;
        });
        tbody.innerHTML = rowsHtml;
    }
    document.getElementById('pie-modal').style.display = 'flex';
}

function closePieModal() { document.getElementById('pie-modal').style.display = 'none'; }

function openPublishDetails(task, version, commentRaw, author, dateRaw, folderId) {
    const comment = decodeURIComponent(commentRaw);
    document.getElementById('publish-modal-author').innerText = decodeURIComponent(author);
    
    const d = new Date(dateRaw);
    document.getElementById('publish-modal-date').innerText = d.toLocaleDateString() + ' @ ' + d.toLocaleTimeString();
    
    const commentDiv = document.getElementById('publish-modal-comment');
    commentDiv.innerText = comment ? comment : "No comments attached to this publish version via Ayon hooks.";
    if (!comment) {
        commentDiv.style.color = "var(--text-secondary)";
        commentDiv.style.fontStyle = "italic";
    } else {
        commentDiv.style.color = "#fff";
        commentDiv.style.fontStyle = "normal";
    }
    
    const activeProject = document.getElementById("lifecycle-project-selector").value;
    const ayonLink = generateAyonLink(activeProject, folderId);
    document.getElementById('publish-modal-ayon-btn').href = ayonLink;
    
    document.getElementById('publish-modal').style.display = 'flex';
}

function closePublishModal() { document.getElementById('publish-modal').style.display = 'none'; }

async function loadOverviewData(projectName) {
    // Also sync the Assets tracked
    if (document.getElementById("asset-project-selector").value !== projectName) {
        document.getElementById("asset-project-selector").value = projectName;
        await loadTrackingData(projectName);
    }
    
    const feedContainer = document.getElementById("overview-feed");
    if (!feedContainer) return;

    feedContainer.innerHTML = "<p style='color:var(--text-secondary);'>Scanning network...</p>";
    
    try {
        const response = await fetch("/api/metrics/daily", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projects: [projectName] })
        });
        const data = await response.json();
        
        if (!data[projectName] || data[projectName].publishes.length === 0) {
            feedContainer.innerHTML = "<p style='color:var(--text-secondary); padding: 20px;'>No isolated publishes in the last 24h.</p>";
            return;
        }
        
        let html = "";
        data[projectName].publishes.forEach(pub => {
            const timeStr = pub.date ? new Date(pub.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "";
            const statusColor = pub.status.toLowerCase().includes('approve') ? 'var(--accent-green)' : 'var(--accent-teal)';
            html += `
                <div class="feed-item">
                    <div class="feed-header">
                        <strong>${pub.author}</strong> <span style="color: ${statusColor}; font-weight:700;">${pub.version}</span>
                    </div>
                    <div class="feed-meta">
                        <span>${timeStr}</span> &bull; <span class="feed-task">${pub.task}</span>
                    </div>
                    <div style="color:var(--text-primary); font-family:monospace; font-size: 0.85rem; word-break: break-all;">
                        ${pub.asset_path}
                    </div>
                </div>
            `;
        });
        feedContainer.innerHTML = html;
        
    } catch (e) {
        console.error("Overview feed error:", e);
        feedContainer.innerHTML = "<p style='color:var(--accent-red);'>Secure connection failed.</p>";
    }
}

async function loadLifecycleAssets(projectName) {
    const list = document.getElementById("lifecycle-asset-selector");
    if (!list) return;

    list.innerHTML = '<option value="">Establish secure link...</option>';
    
    try {
        const response = await fetch(`/api/metrics/tracking/${projectName}`);
        const payload = await response.json();
        
        let html = '<option value="">-- Select Target Asset --</option>';
        Object.values(payload.tracking_data).forEach(folder => {
            html += `<option value="${folder.asset_id}">${folder.name}</option>`;
        });
        list.innerHTML = html;
        
        if (lifecycleLineInstance) {
            lifecycleLineInstance.destroy();
            lifecycleLineInstance = null;
        }
    } catch (e) { console.error("Lifecycle asset map error:", e); }
}

async function loadLifecycleChart(projectName, folderId) {
    if (!folderId) return;
    const container = document.getElementById('lifecycle-timeline');
    if (!container) return;
    
    container.innerHTML = "<div style='padding: 40px; color: var(--text-secondary);'>Retrieving chronological lifecycle...</div>";
    
    try {
        const response = await fetch(`/api/metrics/lifecycle/${projectName}/${folderId}`);
        const data = await response.json();
        const timeline = data.lifecycle;
        
        if (timeline.length === 0) {
            container.innerHTML = "<div style='padding: 40px; color: var(--accent-red);'>No chronological telemetry found for this asset.</div>";
            return;
        }

        let html = "";
        
        const uniqueEvents = [];
        const seenSignatures = new Set();

        timeline.forEach(t => {
            if (t.event_type === 'publish') {
                const timeKey = t.date.substring(0, 16); 
                const sig = `publish_${t.task}_${t.version}_${timeKey}`;
                if (!seenSignatures.has(sig)) {
                    uniqueEvents.push(t);
                    seenSignatures.add(sig);
                }
            } else {
                uniqueEvents.push(t);
            }
        });
        
        const columns = {};
        
        uniqueEvents.forEach(t => {
            if (t.event_type === 'assignment' && (t.author === 'Unassigned' || !t.author)) return;
            
            const colName = t.event_type === 'creation' ? 'Asset Initialization' : t.task;
            if (!columns[colName]) columns[colName] = [];
            columns[colName].push(t);
        });
        
        html += `<div class="kanban-board" style="display: flex; gap: 30px; overflow-x: auto; padding-bottom: 20px; align-items: flex-start;">`;
        
        // A column is considered "active" if it has at least one real event:
        //   - a publish, OR
        //   - an assignment with an actual artist (non-empty, non-'Unassigned'), OR
        //   - a status change whose status is NOT 'not ready'
        const colNamesRaw = Object.keys(columns);
        const isActiveCol = col => {
            if (col === 'Asset Initialization') return true;
            return columns[col].some(e => {
                if (e.event_type === 'publish') return true;
                if (e.event_type === 'assignment' && e.author && e.author !== 'Unassigned') return true;
                if (e.event_type === 'status_change' && (e.status || '').toLowerCase() !== 'not ready') return true;
                return false;
            });
        };

        // Build the task filter checkboxes — active ones checked by default
        const filterContainer = document.getElementById('lifecycle-task-checkboxes');
        if (filterContainer) {
            filterContainer.innerHTML = '';
            colNamesRaw.filter(c => c !== 'Asset Initialization').sort().forEach(col => {
                const active = isActiveCol(col);
                filterContainer.innerHTML += `<label class="dropdown-item"><input type="checkbox" value="${col}" ${active ? 'checked' : ''} onchange="rebuildLifecycleKanban()"> ${col}</label>`;
            });
        }

        // Persist columns + html builder to a closure for rebuildLifecycleKanban to re-use
        window._lifecycleColumns = columns;
        window._lifecycleIsActiveCol = isActiveCol;

        const colNames = colNamesRaw.filter(col => {
            if (col === 'Asset Initialization') return true;
            // Respect the task filter checkboxes if they exist
            const cb = filterContainer && filterContainer.querySelector(`input[value="${col}"]`);
            return cb ? cb.checked : isActiveCol(col);
        }).sort((a,b) => {
            if (a === 'Asset Initialization') return -1;
            if (b === 'Asset Initialization') return 1;
            return a.localeCompare(b);
        });
        
        colNames.forEach(col => {
            html += `<div class="timeline-column" style="display: flex; flex-direction: column; min-width: 380px; max-width: 440px; padding-right: 10px;">`;
            html += `<div style="font-size: 1.1rem; font-weight: 700; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid var(--panel-border); color: var(--text-primary); text-transform: uppercase;">${col}</div>`;
            html += `<div class="timeline-container" style="padding: 0 0 20px 0;">`;
            
            columns[col].forEach(t => {
                const dateObj = new Date(t.date);
                const dateOnly = dateObj.toLocaleDateString([], {month:'short', day:'numeric'});
                const timeOnly = dateObj.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                
                let statusColor = '#9e9e9e';
                let titleHtml = '';
                let extraParams = '';
                
                if (t.event_type === 'creation') {
                    statusColor = '#26a69a'; // Material Teal
                    titleHtml = `<span class="timeline-title-prefix">Asset Created:</span> ${t.task}`;
                    t.author = 'Pipeline';
                } else if (t.event_type === 'assignment') {
                    statusColor = '#66bb6a'; // Material Green
                    titleHtml = `<span class="timeline-title-prefix">Task Assigned:</span> ${t.task} <span style="font-size: 0.85em; opacity: 0.7;">(${t.department})</span>`;
                } else if (t.event_type === 'status_change') {
                    statusColor = '#ffa726'; // Material Orange/Yellow
                    titleHtml = `<span class="timeline-title-prefix">Status Update:</span> ${t.task} <span style="font-size: 0.85em; opacity: 0.7;">(${t.department})</span>`;
                } else {
                    statusColor = '#42a5f5'; // Material Blue
                    titleHtml = `<span class="timeline-title-prefix">Publish ${t.version || ''}:</span> ${t.task} <span style="font-size: 0.85em; opacity: 0.7;">(${t.department})</span>`;
                    titleHtml += ` <span style="font-size:0.75em; border: 1px solid var(--panel-border); border-radius: 4px; padding: 2px 6px; margin-left: 5px; color: var(--text-secondary); background: rgba(255,255,255,0.05);">Details</span>`;
                    
                    const safeComment = encodeURIComponent(t.comment || "");
                    const safeTask = encodeURIComponent(t.task || "");
                    const safeAuthor = encodeURIComponent(t.author || "");
                    extraParams = `style="cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'" onclick="openPublishDetails('${safeTask}', '${t.version || ''}', '${safeComment}', '${safeAuthor}', '${t.date}', '${t.folder_id}')"`;
                }
                
                html += `
                    <div class="timeline-node" ${extraParams}>
                        <div class="timeline-point" style="background: ${statusColor}; box-shadow: 0 0 10px ${statusColor}80;"></div>
                        
                        <div class="timeline-content" style="background: ${statusColor}15; border: 1px solid ${statusColor}40;">
                            <!-- Left Block: Uniform Date/Time -->
                            <div class="timeline-date-block">
                                <span class="timeline-date-primary">${dateOnly}</span>
                                <span class="timeline-date-secondary">${timeOnly}</span>
                            </div>
                            
                            <!-- Middle Block: Flexible Title & Vertical Status -->
                            <div class="timeline-main-block">
                                <div class="timeline-title">
                                    ${titleHtml}
                                </div>
                                <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 4px;">
                                    <span class="status-pill">${t.status}</span>
                                    <div class="timeline-author-block" style="display: flex; align-items: center; gap: 6px; padding: 0; background: transparent;">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="timeline-author-icon" stroke="var(--text-secondary)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                        <span class="timeline-author-text" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500;">${t.author || 'System'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            html += `</div></div>`;
        });
        
        html += `</div>`;
        container.innerHTML = html;
        
    } catch (e) {
        console.error("Lifecycle telemetry failed:", e);
        container.innerHTML = "<div style='padding: 40px; color: var(--accent-red);'>Connection closed.</div>";
    }
}

/* ================================================
   GANTT PLANNER ENGINE
================================================ */
let ganttState = {
    projectName: '',
    assets: [],          // Processed asset rows
    viewMode: 'month',   // 'week' | 'month' | 'quarter'
    dayWidth: 28,
    expandedAssets: new Set(),
    ganttStart: null,    // JS Date — left edge of the visible timeline
    ganttEnd: null,
    rowHeight: { asset: 44, task: 36 },
    headerHeight: 60,    // month-row + day-row
};

const STATUS_COLORS = {
    'approved': '#099c6b',
    'complete': '#1aa192',
    'done':     '#1aa192',
    'in progress': '#2962ff',
    'in_progress': '#2962ff',
    'correction': '#ef6c00',
    'review': '#7b1fa2',
    'pending review': '#7b1fa2',
    'not ready': '#5b4965',
    'on hold': '#78716c',
    'default': '#42a5f5',
};

function ganttStatusColor(status) {
    const s = (status || '').toLowerCase();
    for (const [k, v] of Object.entries(STATUS_COLORS)) {
        if (s.includes(k)) return v;
    }
    return STATUS_COLORS.default;
}

function ganttDateToISO(d) {
    // d is a JS Date → returns "YYYY-MM-DD"
    return d.toISOString().slice(0, 10);
}

function ganttDaysBetween(a, b) {
    return Math.round((b - a) / 86400000);
}

function ganttDateAtOffset(offsetDays) {
    const d = new Date(ganttState.ganttStart);
    d.setDate(d.getDate() + offsetDays);
    return d;
}

function ganttOffsetOfDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    return ganttDaysBetween(ganttState.ganttStart, d);
}

async function loadPlannerData(projectName) {
    if (!projectName) return;
    ganttState.projectName = projectName;

    const sidebar = document.getElementById('gantt-sidebar-rows');
    const barsArea = document.getElementById('gantt-bars-area');
    const header   = document.getElementById('gantt-header');
    sidebar.innerHTML = `<div style="padding:20px;color:var(--text-secondary);">Loading project data...</div>`;
    barsArea.innerHTML = '';
    header.innerHTML   = '';

    try {
        const resp = await fetch(`/api/metrics/tracking/${projectName}`, { headers: { 'Cache-Control': 'no-cache' } });
        const data = await resp.json();
        const tracking = data.tracking_data || {};

        // Build asset list
        const assets = Object.values(tracking).map(asset => {
            const tasks = (asset.tasks || []).map(t => ({
                ...t,
                start: t.start_date ? t.start_date.slice(0, 10) : null,
                end:   t.end_date   ? t.end_date.slice(0, 10)   : null,
            }));

            // Asset summary bar = min task start → max task end
            const taskStarts = tasks.map(t => t.start).filter(Boolean).sort();
            const taskEnds   = tasks.map(t => t.end).filter(Boolean).sort();
            return {
                id:     asset.asset_id,
                name:   asset.name,
                path:   asset.path,
                type:   asset.type,
                tasks,
                assetStart: taskStarts[0] || null,
                assetEnd:   taskEnds[taskEnds.length - 1] || null,
            };
        }).sort((a, b) => a.path.localeCompare(b.path));

        ganttState.assets = assets;

        // Determine gantt date window
        const allDates = [];
        assets.forEach(a => {
            if (a.assetStart) allDates.push(new Date(a.assetStart));
            if (a.assetEnd)   allDates.push(new Date(a.assetEnd));
        });
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let minDate = allDates.length ? new Date(Math.min(...allDates)) : new Date(today);
        let maxDate = allDates.length ? new Date(Math.max(...allDates)) : new Date(today);
        minDate.setDate(minDate.getDate() - 14);
        maxDate.setDate(maxDate.getDate() + 30);
        ganttState.ganttStart = minDate;
        ganttState.ganttEnd   = maxDate;

        renderGantt();
    } catch (e) {
        console.error('Planner load error:', e);
        sidebar.innerHTML = `<div style="padding:20px;color:var(--accent-red);">Failed to load project data.</div>`;
    }
}

function renderGantt() {
    const { assets, ganttStart, ganttEnd, dayWidth, rowHeight, expandedAssets } = ganttState;
    const totalDays   = ganttDaysBetween(ganttStart, ganttEnd) + 1;
    const totalWidth  = totalDays * dayWidth;

    const sidebar  = document.getElementById('gantt-sidebar-rows');
    const barsArea = document.getElementById('gantt-bars-area');
    const header   = document.getElementById('gantt-header');

    // ---- Build rows list ----
    const rows = []; // { type:'asset'|'task', data, assetId }
    assets.forEach(a => {
        rows.push({ type: 'asset', data: a, assetId: a.id });
        if (expandedAssets.has(a.id)) {
            a.tasks.forEach(t => rows.push({ type: 'task', data: t, assetId: a.id }));
        }
    });

    const totalRowsHeight = rows.reduce((s, r) => s + rowHeight[r.type], 0);

    // ---- HEADER ----
    // Month band
    let monthHtml = `<div class="gantt-month-label">`;
    let d = new Date(ganttStart);
    let curMonth = -1, curMonthCount = 0;
    const dayCells = [];
    for (let i = 0; i < totalDays; i++) {
        const day = new Date(ganttStart);
        day.setDate(day.getDate() + i);
        dayCells.push(day);
        if (day.getMonth() !== curMonth) {
            if (curMonth !== -1) {
                monthHtml += `<div class="gantt-month-cell" style="width:${curMonthCount * dayWidth}px">${new Date(ganttStart.getFullYear(), curMonth, 1).toLocaleString('default',{month:'short'})} ${day.getFullYear() !== ganttStart.getFullYear() ? new Date(ganttStart.getFullYear(), curMonth, 1).getFullYear() : ''}</div>`;
            }
            curMonth = day.getMonth();
            curMonthCount = 0;
        }
        curMonthCount++;
    }
    monthHtml += `<div class="gantt-month-cell" style="width:${curMonthCount * dayWidth}px">${new Date(ganttStart.getFullYear(), curMonth, 1).toLocaleString('default',{month:'short'})}</div>`;
    monthHtml += `</div>`;

    const todayOffset = ganttDaysBetween(ganttStart, new Date());
    let daysHtml = `<div class="gantt-days-row">`;
    dayCells.forEach((day, i) => {
        const isToday   = (i === todayOffset);
        const isWeekend = [0,6].includes(day.getDay());
        const cls = [isToday ? 'today' : '', isWeekend ? 'weekend' : ''].filter(Boolean).join(' ');
        daysHtml += `<div class="gantt-day-cell ${cls}" style="width:${dayWidth}px">${day.getDate()}<br><span style="font-size:0.6rem;">${['Su','Mo','Tu','We','Th','Fr','Sa'][day.getDay()]}</span></div>`;
    });
    daysHtml += `</div>`;

    // Sticky corner placeholder (aligns with sidebar width)
    header.innerHTML = monthHtml + daysHtml;

    // ---- SIDEBAR + BARS AREA ----
    let sidebarHtml = `<div class="gantt-sidebar-header">Asset / Task</div>`;
    let barsHtml = ``;

    // Today line
    if (todayOffset >= 0 && todayOffset <= totalDays) {
        barsHtml += `<div class="gantt-today-line" style="left:${todayOffset * dayWidth}px; height:${totalRowsHeight}px;"></div>`;
    }

    let rowTop = 0;
    rows.forEach((row, ri) => {
        const rh = rowHeight[row.type];
        const isAsset = row.type === 'asset';

        // Sidebar row
        if (isAsset) {
            const isExpanded = expandedAssets.has(row.data.id);
            sidebarHtml += `
                <div class="gantt-asset-row" onclick="ganttToggleExpand('${row.data.id}')">
                    <span class="gantt-expand-arrow ${isExpanded ? 'open' : ''}">▶</span>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${row.data.path}">${row.data.name}</span>
                </div>`;
        } else {
            const t = row.data;
            const dotColor = ganttStatusColor(t.status);
            sidebarHtml += `
                <div class="gantt-task-row" title="${t.task_name} • ${t.status}">
                    <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block;margin-right:8px;"></span>
                    <span>${t.task_name}</span>
                </div>`;
        }

        // Background stripe
        barsHtml += `<div class="gantt-row-bg ${isAsset ? 'asset' : ''}" style="top:${rowTop}px; height:${rh}px; width:${totalWidth}px;"></div>`;

        // Bar
        if (isAsset) {
            const startOff = ganttOffsetOfDate(row.data.assetStart);
            const endOff   = ganttOffsetOfDate(row.data.assetEnd);
            if (startOff !== null && endOff !== null) {
                const barW = Math.max((endOff - startOff + 1) * dayWidth, 4);
                const color = '#5b4965';
                barsHtml += `
                    <div class="gantt-bar" style="left:${startOff * dayWidth}px; width:${barW}px; top:${rowTop + 9}px; background:${color}; opacity:0.7;">
                        <span>${row.data.name}</span>
                    </div>`;
            }
        } else {
            const t = row.data;
            const startOff = ganttOffsetOfDate(t.start);
            const endOff   = ganttOffsetOfDate(t.end);
            const color    = ganttStatusColor(t.status);

            if (startOff !== null || endOff !== null) {
                const sOff = startOff !== null ? startOff : (endOff - 1);
                const eOff = endOff   !== null ? endOff   : (startOff + 1);
                const barW = Math.max((eOff - sOff + 1) * dayWidth, 4);
                const label = t.task_name;
                barsHtml += `
                    <div class="gantt-bar" 
                         id="gbar-${t.task_id}"
                         data-task-id="${t.task_id}"
                         data-asset-id="${row.assetId}"
                         data-start="${t.start || ''}"
                         data-end="${t.end || ''}"
                         style="left:${sOff * dayWidth}px; width:${barW}px; top:${rowTop + 5}px; height:26px; background:${color};"
                         onmousedown="ganttBarMousedown(event, 'move')"
                    >
                        ${barW > 50 ? `<span>${label}</span>` : ''}
                        <div class="gantt-bar-handle" onmousedown="ganttBarMousedown(event, 'resize')"></div>
                    </div>`;
            } else {
                // No dates — placeholder
                barsHtml += `
                    <div class="gantt-bar no-date" style="left:${(todayOffset > 0 ? todayOffset : 0) * dayWidth}px; width:${dayWidth * 2}px; top:${rowTop + 5}px; height:26px;">
                        <span style="font-size:0.65rem;">No date</span>
                    </div>`;
            }
        }

        rowTop += rh;
    });

    barsArea.style.height = totalRowsHeight + 'px';
    barsArea.style.width  = totalWidth + 'px';
    sidebar.innerHTML  = sidebarHtml;
    barsArea.innerHTML = barsHtml;
}

function ganttToggleExpand(assetId) {
    if (ganttState.expandedAssets.has(assetId)) {
        ganttState.expandedAssets.delete(assetId);
    } else {
        ganttState.expandedAssets.add(assetId);
    }
    renderGantt();
}

/* ---- Drag / Resize engine ---- */
let _ganttDrag = null;

function ganttBarMousedown(e, mode) {
    e.preventDefault();
    e.stopPropagation();
    const bar = mode === 'resize' ? e.currentTarget.parentElement : e.currentTarget;
    if (!bar.dataset.taskId) return;

    const startX    = e.clientX;
    const origLeft  = parseInt(bar.style.left);
    const origWidth = parseInt(bar.style.width);

    bar.classList.add('dragging');
    _ganttDrag = { bar, mode, startX, origLeft, origWidth };

    const tooltip = ganttGetTooltip();
    tooltip.style.display = 'block';

    document.addEventListener('mousemove', _ganttOnMousemove);
    document.addEventListener('mouseup',   _ganttOnMouseup, { once: true });
}

function _ganttOnMousemove(e) {
    if (!_ganttDrag) return;
    const { bar, mode, startX, origLeft, origWidth } = _ganttDrag;
    const { dayWidth } = ganttState;
    const dx    = e.clientX - startX;
    const dDays = Math.round(dx / dayWidth);

    let newLeft  = origLeft;
    let newWidth = origWidth;

    if (mode === 'move') {
        newLeft = Math.max(0, origLeft + dDays * dayWidth);
        bar.style.left = newLeft + 'px';
    } else {
        newWidth = Math.max(dayWidth, origWidth + dDays * dayWidth);
        bar.style.width = newWidth + 'px';
    }

    // Update tooltip
    const startOff = Math.round(newLeft / dayWidth);
    const endOff   = mode === 'move' ? startOff + Math.round(origWidth / dayWidth) - 1
                                     : Math.round(newLeft / dayWidth) + Math.round(newWidth / dayWidth) - 1;
    const startDate = ganttDateAtOffset(startOff);
    const endDate   = ganttDateAtOffset(endOff);
    const tooltip   = ganttGetTooltip();
    tooltip.innerHTML = `<b>${bar.querySelector('span') ? bar.querySelector('span').textContent : 'Task'}</b><br>${ganttDateToISO(startDate)} → ${ganttDateToISO(endDate)}`;
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top  = (e.clientY - 10) + 'px';
}

async function _ganttOnMouseup(e) {
    if (!_ganttDrag) return;
    const { bar, mode, origLeft, origWidth } = _ganttDrag;
    bar.classList.remove('dragging');
    ganttGetTooltip().style.display = 'none';
    document.removeEventListener('mousemove', _ganttOnMousemove);

    const { dayWidth, projectName } = ganttState;
    const newLeft  = parseInt(bar.style.left);
    const newWidth = parseInt(bar.style.width);
    const startOff = Math.round(newLeft / dayWidth);
    const endOff   = mode === 'move'
        ? startOff + Math.round(origWidth / dayWidth) - 1
        : Math.round(newLeft / dayWidth) + Math.round(newWidth / dayWidth) - 1;

    const newStart = ganttDateToISO(ganttDateAtOffset(startOff));
    const newEnd   = ganttDateToISO(ganttDateAtOffset(endOff));
    const taskId   = bar.dataset.taskId;
    const assetId  = bar.dataset.assetId;

    // Optimistic update state
    const asset = ganttState.assets.find(a => a.id === assetId);
    if (asset) {
        const task = asset.tasks.find(t => t.task_id === taskId);
        if (task) {
            task.start = newStart;
            task.end   = newEnd;
            // Recalculate asset summary
            const starts = asset.tasks.map(t => t.start).filter(Boolean).sort();
            const ends   = asset.tasks.map(t => t.end).filter(Boolean).sort();
            asset.assetStart = starts[0] || null;
            asset.assetEnd   = ends[ends.length - 1] || null;
        }
    }

    // Persist to Ayon
    try {
        const resp = await fetch('/api/metrics/planner/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_name: projectName, task_id: taskId, start_date: newStart, end_date: newEnd })
        });
        const result = await resp.json();
        const indicator = document.getElementById('gantt-save-indicator');
        if (indicator) {
            indicator.style.opacity = '1';
            setTimeout(() => indicator.style.opacity = '0', 2000);
        }
    } catch (err) {
        console.error('Gantt save error:', err);
    }

    _ganttDrag = null;
    renderGantt();
}

function ganttGetTooltip() {
    let t = document.getElementById('gantt-tooltip');
    if (!t) {
        t = document.createElement('div');
        t.id = 'gantt-tooltip';
        document.body.appendChild(t);
    }
    return t;
}

function setGanttView(mode) {
    ganttState.viewMode = mode;
    const widths = { week: 48, month: 28, quarter: 16 };
    ganttState.dayWidth = widths[mode] || 28;
    document.querySelectorAll('.gantt-view-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`gantt-view-${mode}`);
    if (btn) btn.classList.add('active');
    renderGantt();
}

function toggleLifecycleTaskDropdown() {
    document.getElementById('lifecycle-task-checkboxes').classList.toggle('show');
}

function rebuildLifecycleKanban() {
    const columns = window._lifecycleColumns;
    if (!columns) return;

    const filterContainer = document.getElementById('lifecycle-task-checkboxes');
    const isActiveCol = window._lifecycleIsActiveCol || (() => true);

    const colNames = Object.keys(columns).filter(col => {
        if (col === 'Asset Initialization') return true;
        const cb = filterContainer && filterContainer.querySelector(`input[value="${col}"]`);
        return cb ? cb.checked : isActiveCol(col);
    }).sort((a,b) => {
        if (a === 'Asset Initialization') return -1;
        if (b === 'Asset Initialization') return 1;
        return a.localeCompare(b);
    });

    let html = `<div class="kanban-board" style="display: flex; gap: 30px; overflow-x: auto; padding-bottom: 20px; align-items: flex-start;">`;

    colNames.forEach(col => {
        html += `<div class="timeline-column" style="display: flex; flex-direction: column; min-width: 380px; max-width: 440px; padding-right: 10px;">`;
        html += `<div style="font-size: 1.1rem; font-weight: 700; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid var(--panel-border); color: var(--text-primary); text-transform: uppercase;">${col}</div>`;
        html += `<div class="timeline-container" style="padding: 0 0 20px 0;">`;

        columns[col].forEach(t => {
            const dateObj = new Date(t.date);
            const dateOnly = dateObj.toLocaleDateString([], {month:'short', day:'numeric'});
            const timeOnly = dateObj.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            let statusColor = '#9e9e9e';
            let titleHtml = '';
            let extraParams = '';

            if (t.event_type === 'creation') {
                statusColor = '#26a69a';
                titleHtml = `<span class="timeline-title-prefix">Asset Created:</span> ${t.task}`;
                t.author = 'Pipeline';
            } else if (t.event_type === 'assignment') {
                statusColor = '#66bb6a';
                titleHtml = `<span class="timeline-title-prefix">Task Assigned:</span> ${t.task} <span style="font-size:0.85em;opacity:0.7;">(${t.department})</span>`;
            } else if (t.event_type === 'status_change') {
                statusColor = '#ffa726';
                titleHtml = `<span class="timeline-title-prefix">Status Update:</span> ${t.task} <span style="font-size:0.85em;opacity:0.7;">(${t.department})</span>`;
            } else {
                statusColor = '#42a5f5';
                titleHtml = `<span class="timeline-title-prefix">Publish ${t.version || ''}:</span> ${t.task} <span style="font-size:0.85em;opacity:0.7;">(${t.department})</span>`;
                titleHtml += ` <span style="font-size:0.75em;border:1px solid var(--panel-border);border-radius:4px;padding:2px 6px;margin-left:5px;color:var(--text-secondary);background:rgba(255,255,255,0.05);">Details</span>`;
                const safeComment = encodeURIComponent(t.comment || "");
                const safeTask = encodeURIComponent(t.task || "");
                const safeAuthor = encodeURIComponent(t.author || "");
                extraParams = `style="cursor:pointer;box-shadow:0 4px 6px rgba(0,0,0,0.3);transition:transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'" onclick="openPublishDetails('${safeTask}','${t.version||''}','${safeComment}','${safeAuthor}','${t.date}','${t.folder_id}')"`;
            }

            html += `
                <div class="timeline-node" ${extraParams}>
                    <div class="timeline-point" style="background:${statusColor};box-shadow:0 0 10px ${statusColor}80;"></div>
                    <div class="timeline-content" style="background:${statusColor}15;border:1px solid ${statusColor}40;">
                        <div class="timeline-date-block">
                            <span class="timeline-date-primary">${dateOnly}</span>
                            <span class="timeline-date-secondary">${timeOnly}</span>
                        </div>
                        <div class="timeline-main-block">
                            <div class="timeline-title">${titleHtml}</div>
                            <div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin-top:4px;">
                                <span class="status-pill">${t.status}</span>
                                <div style="display:flex;align-items:center;gap:6px;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                    <span style="font-size:0.8rem;color:var(--text-secondary);font-weight:500;">${t.author || 'System'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
        });

        html += `</div></div>`;
    });

    html += `</div>`;
    document.getElementById('lifecycle-timeline').innerHTML = html;
}