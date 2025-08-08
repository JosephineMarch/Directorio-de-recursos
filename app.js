document.addEventListener('DOMContentLoaded', () => {
    // Encapsulamos para evitar variables globales
    const app = new ResourceManager();
    // Exponemos un controlador global para las funciones llamadas desde el HTML (onclick)
    window.appController = {
        openModal: (index = -1) => app.openModal(index),
        togglePinned: (index) => app.togglePinned(index),
        confirmDelete: (index) => app.confirmDelete(index),
        handleCardClick: (event, index) => app.handleCardClick(event, index),
        handleCategoryFilter: (category) => app.handleCategoryFilter(category),
    };
});

class ResourceManager {
    constructor() {
        this.resources = [];
        this.currentEditIndex = -1;
        this.selectedIndices = new Set();
        this.state = { search: '', category: '' };
        this.init();
    }

    init() {
        this.loadResources();
        this.setupEventListeners();
        this.renderAll();
    }

    // --- MANEJO DE DATOS (Lectura/Escritura) ---
    loadResources() {
        this.resources = JSON.parse(localStorage.getItem('resources') || '[]');
        this.state.search = localStorage.getItem('search') || '';
        this.state.category = localStorage.getItem('category') || '';
    }

    saveResources() {
        localStorage.setItem('resources', JSON.stringify(this.resources));
        localStorage.setItem('search', this.state.search);
        localStorage.setItem('category', this.state.category);
    }
    
    // --- RENDERIZADO CENTRAL ---
    renderAll() {
        this.renderResources();
        this.renderCategoryTabs();
        this.updateCategoryFilter('categoryFilter');
        this.applyFilters();
        this.updateSelectionUI();
        document.getElementById('searchInput').value = this.state.search;
    }

    // --- CONFIGURACIÓN DE EVENTOS ---
    setupEventListeners() {
        document.getElementById('addResourceBtn').addEventListener('click', () => this.openModal());
        document.getElementById('emptyStateAddBtn').addEventListener('click', () => this.openModal());
        document.getElementById('closeModalBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('cancelBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('resourceForm').addEventListener('submit', (e) => this.handleFormSubmit(e));
        document.getElementById('searchInput').addEventListener('input', (e) => { this.state.search = e.target.value.toLowerCase(); this.applyFilters(); });
        document.getElementById('categoryFilter').addEventListener('change', (e) => this.handleCategoryFilter(e.target.value));
        document.getElementById('confirmCancelBtn').addEventListener('click', () => this.closeConfirmModal());
        document.getElementById('selectAllCheckbox').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        document.getElementById('bulkChangeCategoryBtn').addEventListener('click', () => this.openBulkCategoryModal());
        document.getElementById('bulkDeleteBtn').addEventListener('click', () => this.confirmBulkDelete());
        document.getElementById('bulkCategoryCancelBtn').addEventListener('click', () => this.closeBulkCategoryModal());
        document.getElementById('bulkCategoryOkBtn').addEventListener('click', () => this.handleBulkChangeCategory());

        const importBtn = document.getElementById('importBtn');
        const importFile = document.getElementById('importFile');
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (e) => this.handleImportFile(e));
    }

    // --- IMPORTACIÓN DE MARCADORES ---
    async handleImportFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const importedResources = this.parseChromeBookmarks(text);

            if (importedResources.length === 0) {
                alert('No se encontraron enlaces válidos en el archivo.');
                return;
            }

            this.resources.push(...importedResources);
            this.saveResources();
            
            this.state.search = '';
            this.state.category = '';
            
            this.renderAll();
            alert(`Importación completada: ${importedResources.length} recurso(s) agregado(s).`);
        } catch (error) {
            console.error("Error al importar el archivo:", error);
            alert("Hubo un error al procesar el archivo de marcadores.");
        } finally {
            event.target.value = '';
        }
    }

    /**
     * Parsea el HTML de marcadores siguiendo el algoritmo preciso del usuario.
     * La unidad de proceso es el <DT>. Un <DT> es una carpeta si contiene H3 y DL.
     * Un <DT> es un enlace si contiene A. Lo demás se ignora.
     * @param {string} htmlContent - El contenido del archivo .html.
     * @returns {Array<Object>} Un array de objetos de recursos.
     */
    parseChromeBookmarks(htmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        const results = [];

        function walk(listNode, categoryStack) {
            for (const itemNode of listNode.children) {
                if (itemNode.tagName !== 'DT') {
                    continue;
                }

                const h3 = itemNode.querySelector(':scope > h3');
                const subList = itemNode.querySelector(':scope > dl');
                const a = itemNode.querySelector(':scope > a');

                if (h3 && subList) {
                    const folderName = h3.textContent.trim();
                    const newCategoryStack = [...categoryStack, folderName];
                    walk(subList, newCategoryStack);
                } 
                else if (a && a.href && a.href.startsWith('http')) {
                    // --- INICIO DE LA LÓGICA DE LIMPIEZA ---
                    let cleanStack = [...categoryStack];
                    // Si la primera carpeta es "Barra de marcadores", la quitamos.
                    if (cleanStack.length > 0 && cleanStack[0] === 'Barra de marcadores') {
                        cleanStack.shift(); // .shift() elimina el primer elemento del array.
                    }
                    
                    // Generamos el nombre de la categoría con la pila ya limpia.
                    const category = cleanStack.length ? cleanStack.join(' / ') : 'Importado';
                    // --- FIN DE LA LÓGICA DE LIMPIEZA ---

                    const addDateAttr = a.getAttribute('add_date');
                    results.push({
                        title: a.textContent.trim() || 'Enlace sin título',
                        url: a.href,
                        email: '',
                        category: category,
                        notes: addDateAttr ? `Añadido: ${new Date(parseInt(addDateAttr, 10) * 1000).toLocaleDateString()}` : '',
                        pinned: false,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        }

        const mainList = doc.querySelector('dl');
        if (mainList) {
            walk(mainList, []);
        }
        
        return results;
    }

    // --- MODALES (Agregar/Editar, Confirmar, etc.) ---
    openModal(index = -1) {
        this.currentEditIndex = index;
        const form = document.getElementById('resourceForm');
        form.reset();
        this.updateCategoryFilter('resourceCategory', true); // Permitir crear nueva

        if (index >= 0) {
            const resource = this.resources[index];
            document.getElementById('modalTitle').textContent = 'Editar Recurso';
            document.getElementById('resourceTitle').value = resource.title;
            document.getElementById('resourceUrl').value = resource.url;
            document.getElementById('resourceEmail').value = resource.email || '';
            document.getElementById('resourceCategory').value = resource.category;
            document.getElementById('resourceNotes').value = resource.notes || '';
            document.getElementById('resourcePinned').checked = resource.pinned || false;
        } else {
            document.getElementById('modalTitle').textContent = 'Nuevo Recurso';
        }
        document.getElementById('resourceModal').classList.remove('hidden');
        document.getElementById('resourceTitle').focus();
    }
    
    closeModal() { document.getElementById('resourceModal').classList.add('hidden'); }
    openBulkCategoryModal() { this.updateCategoryFilter('bulkNewCategory', true); document.getElementById('bulkCategoryModal').classList.remove('hidden'); }
    closeBulkCategoryModal() { document.getElementById('bulkCategoryModal').classList.add('hidden'); }
    closeConfirmModal() { document.getElementById('confirmModal').classList.add('hidden'); }
    
    // --- LÓGICA DE FORMULARIO Y CRUD ---
    handleFormSubmit(e) {
        e.preventDefault();
        let category = document.getElementById('resourceCategory').value;
        if(category === '_NEW_CATEGORY_') {
            const newCat = prompt("Introduce el nombre de la nueva categoría:");
            if (!newCat || newCat.trim() === '') return;
            category = newCat.trim();
        }

        const resourceData = {
            title: document.getElementById('resourceTitle').value.trim(),
            url: document.getElementById('resourceUrl').value.trim(),
            email: document.getElementById('resourceEmail').value.trim(),
            category: category || 'Sin Categoría',
            notes: document.getElementById('resourceNotes').value.trim(),
            pinned: document.getElementById('resourcePinned').checked
        };
        if (!resourceData.title || !resourceData.url) {
            alert('El título y la URL son obligatorios.');
            return;
        }

        if (this.currentEditIndex >= 0) {
            this.resources[this.currentEditIndex] = { ...this.resources[this.currentEditIndex], ...resourceData };
        } else {
            resourceData.createdAt = new Date().toISOString();
            this.resources.push(resourceData);
        }

        this.saveResources();
        this.renderAll();
        this.closeModal();
    }

    confirmDelete(index) {
        const resource = this.resources[index];
        document.getElementById('confirmTitle').textContent = 'Eliminar Recurso';
        document.getElementById('confirmMessage').textContent = `¿Estás seguro de eliminar "${resource.title}"? Esta acción no se puede deshacer.`;
        document.getElementById('confirmOkBtn').onclick = () => {
            this.deleteResource(index);
        };
        document.getElementById('confirmModal').classList.remove('hidden');
    }

    deleteResource(index) {
        this.resources.splice(index, 1);
        this.selectedIndices.delete(index);
        this.saveResources();
        this.renderAll();
        this.closeConfirmModal();
    }
    
    togglePinned(index) {
        this.resources[index].pinned = !this.resources[index].pinned;
        this.saveResources();
        this.renderAll();
    }
    
    // --- RENDERIZADO Y FILTROS ---
    renderResources() {
        const container = document.getElementById('resourcesContainer');
        const emptyState = document.getElementById('emptyState');
        
        if (this.resources.length === 0) {
            container.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }
        emptyState.classList.add('hidden');

        const sortedResources = [...this.resources]
            .map((resource, originalIndex) => ({ ...resource, originalIndex }))
            .sort((a, b) => (b.pinned - a.pinned) || new Date(b.createdAt) - new Date(a.createdAt));

        container.innerHTML = sortedResources.map(res => this.createResourceCard(res, res.originalIndex)).join('');
        this.applyFilters();
    }
    
    createResourceCard(resource, index) {
        const domain = this.getDomainFromUrl(resource.url);
        const pinClass = resource.pinned ? 'pinned' : '';
        const selectedClass = this.selectedIndices.has(index) ? 'selected' : '';

        return `
            <div class="card ${selectedClass}" data-index="${index}" onclick="appController.handleCardClick(event, ${index})">
                <input type="checkbox" class="card__checkbox" ${selectedClass ? 'checked' : ''} data-index="${index}">
                <div class="card__header">
                    <h3 class="card__title">${this.escapeHtml(resource.title)}</h3>
                    <button class="card__pin ${pinClass}" onclick="event.stopPropagation(); appController.togglePinned(${index})">
                        <span class="material-symbols-outlined">push_pin</span>
                    </button>
                </div>
                <div class="card__body">
                    <p class="card__category">${this.escapeHtml(resource.category)}</p>
                    ${resource.notes ? `<p class="card__notes">${this.escapeHtml(resource.notes)}</p>` : ''}
                    ${resource.email ? `<p><b>Correo:</b> ${this.escapeHtml(resource.email)}</p>` : ''}
                </div>
                <div class="card__footer">
                    <p class="card__domain">${this.escapeHtml(domain)}</p>
                    <div class="card__actions">
                        <button class="btn btn--text btn--small" onclick="event.stopPropagation(); appController.openModal(${index})">Editar</button>
                        <a href="${resource.url}" target="_blank" rel="noopener noreferrer" class="btn btn--filled btn--small" onclick="event.stopPropagation()">
                            Abrir <span class="material-symbols-outlined">open_in_new</span>
                        </a>
                    </div>
                </div>
            </div>`;
    }
    
    applyFilters() {
        const query = this.state.search;
        const category = this.state.category;
        let visibleCount = 0;

        document.querySelectorAll('#resourcesContainer > .card').forEach(card => {
            const index = parseInt(card.dataset.index, 10);
            const resource = this.resources[index];
            if (!resource) return;

            const matchesCategory = !category || resource.category === category;
            const matchesSearch = !query || [resource.title, resource.category, resource.notes, resource.url, resource.email]
                .some(field => field && field.toLowerCase().includes(query));
            
            const isVisible = matchesCategory && matchesSearch;
            card.style.display = isVisible ? 'flex' : 'none';
            if(isVisible) visibleCount++;
        });
        
        const emptyState = document.getElementById('emptyState');
        const emptyStateTitle = emptyState.querySelector('.empty-state__title');
        const emptyStateText = emptyState.querySelector('.empty-state__text');
        const emptyStateButton = emptyState.querySelector('button');

        if (this.resources.length === 0) {
            emptyStateTitle.textContent = 'Tu directorio está vacío';
            emptyStateText.textContent = 'Comienza importando tus marcadores o agregando tu primer recurso.';
            emptyStateButton.classList.remove('hidden');
            emptyState.classList.remove('hidden');
        } else if (visibleCount === 0) {
            emptyStateTitle.textContent = 'No se encontraron resultados';
            emptyStateText.textContent = 'Intenta ajustar tu búsqueda o filtros.';
            emptyStateButton.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
        }

        this.updateSelectAllCheckboxState();
    }

    updateCategoryFilter(selectElementId, allowNew = false) {
        const select = document.getElementById(selectElementId);
        const categories = [...new Set(this.resources.map(r => r.category).filter(Boolean))].sort((a,b) => a.localeCompare(b));
        
        const currentValue = select.value;
        select.innerHTML = `<option value="">${selectElementId === 'categoryFilter' ? 'Todas las categorías' : 'Selecciona una categoría'}</option>`;
        categories.forEach(cat => {
            select.innerHTML += `<option value="${this.escapeHtml(cat)}">${this.escapeHtml(cat)}</option>`;
        });
        
        if (allowNew) {
            select.innerHTML += `<option value="_NEW_CATEGORY_">-- Crear nueva categoría --</option>`;
        }
        
        select.value = categories.includes(currentValue) ? currentValue : "";
    }
    
    renderCategoryTabs() {
        const container = document.getElementById('categoryTabs');
        const allCategories = ['Todas', ...[...new Set(this.resources.map(r => r.category).filter(Boolean))].sort((a,b) => a.localeCompare(b))];

        container.innerHTML = allCategories.map(cat => {
            const value = cat === 'Todas' ? '' : cat;
            const activeClass = this.state.category === value ? 'active' : '';
            return `<button class="btn ${activeClass}" onclick="appController.handleCategoryFilter('${this.escapeHtml(value, true)}');">${this.escapeHtml(cat)}</button>`;
        }).join('');
    }
    
    handleCategoryFilter(category) {
        this.state.category = category;
        document.getElementById('categoryFilter').value = category;

        document.querySelector(`#categoryTabs .btn.active`)?.classList.remove('active');
        const btnToActivate = Array.from(document.querySelectorAll(`#categoryTabs .btn`)).find(btn => (btn.textContent === 'Todas' ? '' : btn.textContent) === category);
        if (btnToActivate) btnToActivate.classList.add('active');

        this.applyFilters();
    }

    // --- LÓGICA DE SELECCIÓN EN LOTE ---
    handleCardClick(event, index) {
        if (event.target.closest('a, button')) {
            if (event.target.matches('.card__checkbox')) {
                this.toggleSelection(index);
            }
            return;
        }
        this.toggleSelection(index);
    }
    
    toggleSelection(index) {
        if (this.selectedIndices.has(index)) this.selectedIndices.delete(index);
        else this.selectedIndices.add(index);
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        document.querySelectorAll('.card').forEach(card => {
            const index = parseInt(card.dataset.index, 10);
            const checkbox = card.querySelector('.card__checkbox');
            if (this.selectedIndices.has(index)) {
                card.classList.add('selected');
                if (checkbox) checkbox.checked = true;
            } else {
                card.classList.remove('selected');
                if (checkbox) checkbox.checked = false;
            }
        });

        const selectionCount = this.selectedIndices.size;
        document.getElementById('selectionCount').textContent = `${selectionCount} seleccionado(s)`;
        document.getElementById('bulkActions').classList.toggle('hidden', selectionCount === 0);
        this.updateSelectAllCheckboxState();
    }
    
    toggleSelectAll(checked) {
        const visibleCards = Array.from(document.querySelectorAll('.card')).filter(c => c.style.display !== 'none');
        visibleCards.forEach(card => {
            const index = parseInt(card.dataset.index, 10);
            if(checked) this.selectedIndices.add(index);
            else this.selectedIndices.delete(index);
        });
        this.updateSelectionUI();
    }
    
    updateSelectAllCheckboxState() {
        const visibleCards = Array.from(document.querySelectorAll('.card')).filter(c => c.style.display !== 'none');
        const allVisibleSelected = visibleCards.length > 0 && visibleCards.every(card => this.selectedIndices.has(parseInt(card.dataset.index, 10)));
        document.getElementById('selectAllCheckbox').checked = allVisibleSelected;
    }
    
    handleBulkChangeCategory() {
        let newCategory = document.getElementById('bulkNewCategory').value;
        if(newCategory === '_NEW_CATEGORY_') {
            const cat = prompt("Introduce el nombre de la nueva categoría:");
            if (!cat || cat.trim() === '') return;
            newCategory = cat.trim();
        }

        this.selectedIndices.forEach(index => { this.resources[index].category = newCategory || "Sin Categoría"; });
        this.saveResources();
        this.selectedIndices.clear();
        this.renderAll();
        this.closeBulkCategoryModal();
    }

    confirmBulkDelete() {
        const count = this.selectedIndices.size;
        document.getElementById('confirmTitle').textContent = 'Eliminación en Lote';
        document.getElementById('confirmMessage').textContent = `¿Estás seguro de eliminar los ${count} recursos seleccionados?`;
        document.getElementById('confirmOkBtn').onclick = () => this.bulkDelete();
        document.getElementById('confirmModal').classList.remove('hidden');
    }

    bulkDelete() {
        const indicesToDelete = [...this.selectedIndices].sort((a, b) => b - a);
        indicesToDelete.forEach(index => { this.resources.splice(index, 1); });
        this.selectedIndices.clear();
        this.saveResources();
        this.renderAll();
        this.closeConfirmModal();
    }

    // --- UTILIDADES ---
    getDomainFromUrl(url) {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return 'URL inválida'; }
    }

    escapeHtml(text, forAttribute = false) {
        if (typeof text !== 'string') return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(forAttribute ? /[&<>"']/g : /[&<>]/g, m => map[m]);
    }
}