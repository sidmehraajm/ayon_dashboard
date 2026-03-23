let gridApi = null;
let chartInstance = null;
let globalRawTrackingData = {}; 
let allProjects = [];

document.addEventListener("DOMContentLoaded", async () => {
    await loadProjects();
    
    document.getElementById('asset-search').addEventListener('input', async (e) => {
        if (gridApi) {
            const filterInstance = await gridApi.getColumnFilterInstance('assetName');
            e.target.value.trim() === '' ? filterInstance.setModel(null) : filterInstance.setModel({ type: 'contains', filter: e.target.value });
            gridApi.onFilterChanged();
        }
    });

    document.getElementById('artist-selector').addEventListener('change', filterArtistChart);
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-dropdown')) {
            document.getElementById('status-checkboxes').classList.remove('show');
        }
    });
});

function switchTab(tabId) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).style.display = 'block';
    event.target.classList.add('active');
}

async function loadProjects() {
    try {
        const response = await fetch("/api/projects");
        allProjects = await response.json();
        const assetSelector = document.getElementById("asset-project-selector");
        const artistSelector = document.getElementById("artist-project-selector");
        
        allProjects.forEach(proj => {
            assetSelector.innerHTML += `<option value="${proj}">${proj}</option>`;
            artistSelector.innerHTML += `<option value="${proj}">${proj}</option>`;
        });

        artistSelector.innerHTML = `<option value="ALL" selected>-- ALL PROJECTS --</option>` + artistSelector.innerHTML;

        if (allProjects.length > 0) {
            loadTrackingData(allProjects[0]);
            assetSelector.addEventListener("change", (e) => loadTrackingData(e.target.value));
        }
    } catch (error) {
        console.error("Failed to load projects", error);
    }
}

// ==========================================
// ASSET TRACKING & CUSTOM DROPDOWN
// ==========================================
async function loadTrackingData(projectName) {
    document.getElementById("project-health-summary").innerText = "Establishing secure connection...";
    try {
        const response = await fetch(`/api/metrics/tracking/${projectName}`);
        globalRawTrackingData = await response.json();
        
        populateAssetSearchDropdown();
        buildStatusCheckboxes(); 
    } catch (error) {
        console.error("Tracking Data Error:", error);
    }
}

function populateAssetSearchDropdown() {
    const dataList = document.getElementById("asset-list");
    dataList.innerHTML = "";
    Object.values(globalRawTrackingData).forEach(folder => {
        dataList.innerHTML += `<option value="${folder.name}">`;
    });
}

function toggleStatusDropdown() {
    document.getElementById('status-checkboxes').classList.toggle('show');
}

function buildStatusCheckboxes() {
    const allStatuses = new Set();
    Object.values(globalRawTrackingData).forEach(folder => {
        if (folder.tasks) folder.tasks.forEach(t => allStatuses.add(t.status));
    });

    const container = document.getElementById('status-checkboxes');
    container.innerHTML = "";

    Array.from(allStatuses).sort().forEach(status => {
        // Auto-check statuses that seem like a completion state
        const s = status.toLowerCase();
        const isChecked = s.includes('approve') || s.includes('final') || s.includes('done') || s.includes('deliver') ? 'checked' : '';
        
        container.innerHTML += `
            <label class="dropdown-item">
                <input type="checkbox" value="${status}" ${isChecked} onchange="recalculateHealth()">
                ${status}
            </label>
        `;
    });

    recalculateHealth();
}

function getSelectedStatuses() {
    const checkboxes = document.querySelectorAll('#status-checkboxes input:checked');
    return Array.from(checkboxes).map(cb => cb.value.toLowerCase());
}

// DATE MATH HELPER
function calculateDelay(endDateStr, updatedAtStr) {
    if (!endDateStr) return { text: "N/A", color: "" };
    if (!updatedAtStr) return { text: "Pending", color: "" };
    
    const end = new Date(endDateStr);
    const updated = new Date(updatedAtStr);
    
    const diffTime = updated - end;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return { text: "On Time", color: "#10b981" }; // Green
    return { text: `${diffDays} Days Late`, color: "#ef4444" }; // Red
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
                if (completedStatuses.includes(task.status.toLowerCase())) {
                    completedTasks++;
                }
                
                // Calculate delay for each task
                const delayData = calculateDelay(task.end_date, task.updated_at);
                task.delay_text = delayData.text;
                task.delay_color = delayData.color;
            });
        }

        const health = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        totalTasksGlobal += totalTasks;
        completedTasksGlobal += completedTasks;

        rowData.push({
            assetName: folder.name,
            assetType: folder.type,
            health: health,
            tasks: folder.tasks || [] 
        });
    });

    const globalHealth = totalTasksGlobal > 0 ? Math.round((completedTasksGlobal / totalTasksGlobal) * 100) : 0;
    document.getElementById("project-health-summary").innerHTML = 
        `Global Project Completion: <span style="color: var(--accent-green);">${globalHealth}%</span>`;

    renderMasterDetailGrid(rowData);
}

function renderMasterDetailGrid(rowData) {
    const gridDiv = document.querySelector('#trackingGrid');
    if (gridApi) {
        gridApi.setGridOption('rowData', rowData);
        return;
    }

    const gridOptions = {
        rowData: rowData,
        theme: "ag-theme-alpine-dark",
        masterDetail: true,
        detailCellRendererParams: {
            detailGridOptions: {
                columnDefs: [
                    { field: 'task_name', headerName: 'Task Name', flex: 1 },
                    { field: 'assignees', valueFormatter: p => p.value && p.value.length > 0 ? p.value.join(', ') : 'Unassigned', flex: 1 },
                    { 
                        field: 'status', 
                        flex: 1,
                        cellRenderer: params => {
                            const val = params.value ? params.value.toLowerCase() : '';
                            if (val.includes('approve') || val.includes('final')) return `<span class="status-pill pill-green">${params.value}</span>`;
                            if (val.includes('progress') || val.includes('wip')) return `<span class="status-pill pill-yellow">${params.value}</span>`;
                            return `<span class="status-pill" style="border: 1px solid #444">${params.value}</span>`;
                        }
                    },
                    { 
                        field: 'end_date', 
                        headerName: 'Target End Date',
                        valueFormatter: p => p.value ? new Date(p.value).toLocaleDateString() : 'N/A',
                        flex: 1 
                    },
                    {
                        field: 'delay_text',
                        headerName: 'Delivery Status',
                        flex: 1,
                        cellStyle: params => ({ color: params.data.delay_color, fontWeight: 'bold' })
                    }
                ],
                theme: "ag-theme-alpine-dark",
            },
            getDetailRowData: params => params.successCallback(params.data.tasks)
        },
        columnDefs: [
            { field: "assetName", headerName: "Asset Name", cellRenderer: 'agGroupCellRenderer', flex: 2 },
            { field: "assetType", headerName: "Type", flex: 1 },
            { 
                field: "health", 
                headerName: "Completion Status", 
                flex: 1, 
                valueFormatter: p => p.value + "%",
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
// ARTIST ANALYTICS & MODAL
// ==========================================
let currentArtistData = {};

async function loadArtistData() {
    const selector = document.getElementById("artist-project-selector");
    let selectedProjects = Array.from(selector.selectedOptions).map(opt => opt.value);
    
    if (selectedProjects.includes("ALL")) selectedProjects = allProjects;

    try {
        const response = await fetch("/api/metrics/artists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projects: selectedProjects })
        });
        
        currentArtistData = await response.json();
        
        const artistDropdown = document.getElementById("artist-selector");
        artistDropdown.innerHTML = `<option value="ALL">-- Global View --</option>`;
        Object.keys(currentArtistData).sort().forEach(artist => {
            artistDropdown.innerHTML += `<option value="${artist}">${artist}</option>`;
        });

        filterArtistChart();
    } catch (error) {
        console.error("Artist Data Error:", error);
    }
}

function filterArtistChart() {
    const selectedArtist = document.getElementById("artist-selector").value;
    let dataToRender = currentArtistData;

    if (selectedArtist !== "ALL" && currentArtistData[selectedArtist]) {
        dataToRender = { [selectedArtist]: currentArtistData[selectedArtist] };
    }

    const ctx = document.getElementById('artistChart').getContext('2d');
    const labels = Object.keys(dataToRender);
    const publishCounts = labels.map(a => dataToRender[a].total_publishes);

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Versions Published',
                data: publishCounts,
                backgroundColor: 'rgba(59, 130, 246, 0.8)',
                borderColor: '#3b82f6',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { 
                y: { beginAtZero: true, grid: { color: '#2d313f' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#e2e8f0' } }
            },
            plugins: { legend: { display: false } },
            // CLICK EVENT FOR DRILL-DOWN MODAL
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const artistName = labels[index];
                    openArtistModal(artistName);
                }
            }
        }
    });
}

function openArtistModal(artistName) {
    document.getElementById('modal-title').innerText = `${artistName} - Publish History`;
    const tbody = document.getElementById('modal-tbody');
    tbody.innerHTML = "";
    
    const publishes = currentArtistData[artistName].publishes;
    
    if (publishes.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4'>No recent publishes found.</td></tr>";
    } else {
        publishes.forEach(pub => {
            const dateStr = pub.date ? new Date(pub.date).toLocaleString() : "N/A";
            const statusClass = pub.status.toLowerCase().includes('approve') ? 'pill-green' : 'pill-yellow';
            
            tbody.innerHTML += `
                <tr>
                    <td>${pub.project}</td>
                    <td><span style="color: var(--accent-blue); font-weight: bold;">${pub.version}</span></td>
                    <td><span class="status-pill ${statusClass}">${pub.status}</span></td>
                    <td>${dateStr}</td>
                </tr>
            `;
        });
    }
    
    document.getElementById('artist-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('artist-modal').style.display = 'none';
}