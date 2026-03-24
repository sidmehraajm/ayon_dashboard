// --- AYON CONFIGURATION ---
const AYON_BASE_URL = "http://ayon:5000"; // Ensure this matches your local network setup

let gridApi = null;
let chartInstance = null;
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
            const cb = document.getElementById('status-checkboxes');
            if(cb) cb.classList.remove('show');
        }
    });
});

function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).style.display = 'block';
    event.target.classList.add('active');
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
        
        allProjects.forEach(proj => {
            assetSelector.innerHTML += `<option value="${proj}">${proj}</option>`;
            artistSelector.innerHTML += `<option value="${proj}">${proj}</option>`;
            dailySelector.innerHTML += `<option value="${proj}">${proj}</option>`;
        });

        artistSelector.innerHTML = `<option value="ALL" selected>-- ALL PROJECTS --</option>` + artistSelector.innerHTML;
        dailySelector.innerHTML = `<option value="ALL" selected>-- ALL PROJECTS --</option>` + dailySelector.innerHTML;

        if (allProjects.length > 0) {
            loadTrackingData(allProjects[0]);
            assetSelector.addEventListener("change", (e) => loadTrackingData(e.target.value));
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
    dataList.innerHTML = "";
    Object.values(globalRawTrackingData).forEach(folder => {
        dataList.innerHTML += `<option value="${folder.name}">`;
    });
}

function toggleStatusDropdown() { document.getElementById('status-checkboxes').classList.toggle('show'); }

function buildStatusCheckboxes() {
    const container = document.getElementById('status-checkboxes');
    container.innerHTML = "";

    const bulkSelect = document.getElementById('bulk-status-select');
    if (bulkSelect) bulkSelect.innerHTML = '<option value="">-- Do Not Change Status --</option>';

    // Build the lists using the OFFICIAL statuses from the schema
    currentTrackingStatuses.forEach(status => {
        const s = status.toLowerCase();
        const isChecked = s.includes('approve') || s.includes('final') || s.includes('done') || s.includes('deliver') ? 'checked' : '';
        
        container.innerHTML += `<label class="dropdown-item"><input type="checkbox" value="${status}" ${isChecked} onchange="recalculateHealth()"> ${status}</label>`;
        if (bulkSelect) bulkSelect.innerHTML += `<option value="${status}">${status}</option>`;
    });
    recalculateHealth();
}

function getSelectedStatuses() {
    return Array.from(document.querySelectorAll('#status-checkboxes input:checked')).map(cb => cb.value.toLowerCase());
}

function calculateDelay(endDateStr, updatedAtStr) {
    if (!endDateStr) return { text: "N/A", color: "" };
    if (!updatedAtStr) return { text: "Pending", color: "" };
    
    const diffTime = new Date(updatedAtStr) - new Date(endDateStr);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return { text: "On Time", color: "#10b981" };
    return { text: `${diffDays} Days Late`, color: "#ef4444" };
}

function recalculateHealth() {
    const completedStatuses = getSelectedStatuses();
    const rowData = [];
    let totalTasksGlobal = 0;
    let completedTasksGlobal = 0;

    Object.values(globalRawTrackingData).forEach(folder => {
        const totalTasks = folder.tasks ? folder.tasks.length : 0;
        let completedTasks = 0;

        if (folder.tasks) {
            folder.tasks.forEach(task => {
                if (completedStatuses.includes(task.status.toLowerCase())) completedTasks++;
                const delayData = calculateDelay(task.end_date, task.updated_at);
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

function renderMasterDetailGrid(rowData) {
    const gridDiv = document.querySelector('#trackingGrid');
    if (gridApi) { gridApi.setGridOption('rowData', rowData); return; }

    const activeProject = document.getElementById("asset-project-selector").value;

    const gridOptions = {
        rowData: rowData,
        theme: "ag-theme-alpine-dark",
        masterDetail: true,
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
                            const link = generateAyonLink(activeProject, params.data.folder_id, params.data.task_id);
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

    artistDropdown.innerHTML = `<option value="ALL">-- Global View --</option>`;
    Object.keys(currentArtistData).sort().forEach(artist => {
        artistDropdown.innerHTML += `<option value="${artist}">${artist}</option>`;
        currentArtistData[artist].publishes.forEach(pub => {
            if (pub.asset_path) uniqueAssets.add(pub.asset_path);
        });
    });

    assetDropdown.innerHTML = `<option value="ALL">-- All Assets --</option>`;
    Array.from(uniqueAssets).sort().forEach(asset => {
        const shortName = asset.split('/').slice(-2).join('/');
        assetDropdown.innerHTML += `<option value="${asset}">${shortName}</option>`;
    });

    statusDropdown.innerHTML = `<option value="ALL">-- All Statuses --</option>`;
    currentProjectStatuses.forEach(status => {
        statusDropdown.innerHTML += `<option value="${status}">${status}</option>`;
    });
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
        tbody.innerHTML = "<tr><td colspan='6'>No iterations found matching current filters.</td></tr>";
    } else {
        publishes.forEach(pub => {
            const dateStr = pub.date ? new Date(pub.date).toLocaleString() : "N/A";
            const statusClass = pub.status.toLowerCase().includes('approve') ? 'pill-green' : 'pill-yellow';
            const ayonLink = generateAyonLink(pub.project, pub.folder_id, pub.task_id);
            
            tbody.innerHTML += `
                <tr>
                    <td>${pub.project}</td>
                    <td style="color: var(--text-secondary); font-family: monospace;">${pub.asset_path}</td>
                    <td>${pub.task}</td>
                    <td><span style="color: var(--accent-blue); font-weight: bold;">${pub.version}</span></td>
                    <td><span class="status-pill ${statusClass}">${pub.status}</span></td>
                    <td><a href="${ayonLink}" target="_blank" class="ayon-link">Open ↗</a></td>
                </tr>
            `;
        });
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

        Object.keys(reportData).forEach(project => {
            const projData = reportData[project];
            let rowsHtml = "";
            
            projData.publishes.forEach(pub => {
                const dateStr = pub.date ? new Date(pub.date).toLocaleTimeString() : "N/A";
                const statusClass = pub.status.toLowerCase().includes('approve') ? 'pill-green' : 'pill-yellow';
                const ayonLink = generateAyonLink(project, pub.folder_id, pub.task_id);

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

            container.innerHTML += `
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
    } catch (error) {
        console.error("Daily Report Error:", error);
        container.innerHTML = "<h3 style='color: var(--accent-red);'>Failed to load report.</h3>";
    }
}