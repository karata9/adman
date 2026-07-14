import { db } from './firebase-config.js';
import { collection, addDoc, getDocs, serverTimestamp, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const BUNNY_STORAGE_BASE_URL = "https://storage.bunnycdn.com/lklkklk";
const BUNNY_CDN_BASE_URL = "https://kijhkl.b-cdn.net";
const BUNNY_ACCESS_KEY = "f3a82d70-21b2-4d51-871dd7178960-0cc8-4cf7";

let savedProperties = [];
let savedBanners = [];
let editingPropertyId = null;
let editingPropertyImages = [];
let editingAreaId = null;
let editingServiceId = null;

// === متغيرات الخريطة ===
let map;
let marker;

// === التنقل بين التبويبات ===
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const targetId = btn.dataset.target;
        document.getElementById(targetId).classList.add('active');

        // تحديث حجم الخريطة عند فتح التبويبة لتجنب ظهورها بشكل غير مكتمل
        if(targetId === 'add-property' && map) {
            setTimeout(() => { map.invalidateSize(); }, 100);
        }

        if (targetId === 'manage-properties') fetchPropertiesForAdmin();
        if (targetId === 'manage-banners') fetchBannersForAdmin();
    });
});

// === دالة رفع الصور كما زودتني بها ===
const uploadImageToStorage = async (file) => {
    try {
        return await uploadFileToBunny(file, 'properties');
    } catch (error) {
        console.error("خطأ في رفع الصورة:", error);
        throw error;
    }
};

function sanitizeFileName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'image';
}

async function uploadFileToBunny(file, folder) {
    const cleanName = sanitizeFileName(file.name);
    const remotePath = `${folder}/${Date.now()}-${cleanName}`;
    const uploadUrl = `${BUNNY_STORAGE_BASE_URL}/${remotePath}`;

    const response = await withTimeout(
        fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                AccessKey: BUNNY_ACCESS_KEY,
                'Content-Type': file.type || 'application/octet-stream'
            },
            body: file
        }),
        30000,
        'انتهت مهلة رفع الصورة إلى Bunny. تحقق من الاتصال أو إعدادات Bunny Storage.'
    );

    if (!response.ok) {
        const details = await response.text().catch(() => '');
        throw new Error(`Bunny upload failed (${response.status}) ${details}`);
    }

    return `${BUNNY_CDN_BASE_URL}/${remotePath}`;
}

function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(message)), ms);
        })
    ]);
}

function getImageLinksFromTextarea() {
    const value = document.getElementById('property-image-links')?.value || '';
    return value
        .split(/\r?\n/)
        .map((link) => link.trim())
        .filter((link) => /^https?:\/\//i.test(link));
}

function getFriendlyError(error) {
    const code = error?.code || '';
    const message = error?.message || String(error);

    if (code.includes('storage/unauthorized')) {
        return 'Firebase Storage يمنع رفع الصور. افتح صلاحيات Storage أو استخدم روابط صور مباشرة.';
    }

    if (code.includes('storage/canceled')) {
        return 'تم إلغاء رفع الصورة.';
    }

    if (code.includes('storage/retry-limit-exceeded')) {
        return 'فشل رفع الصورة بسبب ضعف الاتصال أو إعدادات Storage.';
    }

    if (message.includes('Failed to fetch')) {
        return 'لم يصل المتصفح إلى Bunny. غالبا المشكلة من CORS في Bunny أو من رابط Storage Zone.';
    }

    if (message.includes('401') || message.includes('403')) {
        return 'Bunny رفض الرفع. تحقق من Access Key وصلاحيات Storage Zone.';
    }

    if (message.includes('404')) {
        return 'لم يتم العثور على مسار Bunny. تحقق من اسم Storage Zone والرابط.';
    }

    return message;
}

// === جلب المناطق وعرضها ===
async function fetchAreas() {
    const querySnapshot = await getDocs(collection(db, "areas"));
    const propAreaSelect = document.getElementById('prop-area');
    const areasList = document.getElementById('areas-list');
    
    propAreaSelect.innerHTML = '<option value="">اختر المنطقة...</option>';
    areasList.innerHTML = '';

    querySnapshot.forEach((areaDoc) => {
        const data = areaDoc.data();
        propAreaSelect.innerHTML += `<option value="${areaDoc.id}">${escapeHtml(data.name)}</option>`;
        areasList.innerHTML += `
            <li>
                <span>${escapeHtml(data.name)}</span>
                <div class="manager-actions">
                    <button class="edit-btn" data-edit-area="${areaDoc.id}" data-name="${escapeHtml(data.name)}">تعديل</button>
                    <button class="danger-btn" data-delete-area="${areaDoc.id}">حذف</button>
                </div>
            </li>
        `;
    });

    areasList.querySelectorAll('[data-edit-area]').forEach((button) => {
        button.addEventListener('click', () => editArea(button.dataset.editArea, button.closest('li')?.querySelector('span')?.textContent || button.dataset.name || ''));
    });

    areasList.querySelectorAll('[data-delete-area]').forEach((button) => {
        button.addEventListener('click', () => deleteArea(button.dataset.deleteArea));
    });
}

// === إضافة منطقة جديدة ===
document.getElementById('add-area-btn').addEventListener('click', async () => {
    const areaName = document.getElementById('new-area-name').value.trim();
    if (!areaName) {
        alert("يرجى كتابة اسم المنطقة أولاً");
        return;
    }
    const btn = document.getElementById('add-area-btn');
    btn.disabled = true;
    btn.textContent = "جاري الحفظ...";

    try {
        if (editingAreaId) {
            await updateDoc(doc(db, "areas", editingAreaId), { name: areaName });
        } else {
            await addDoc(collection(db, "areas"), {
                name: areaName,
                createdAt: serverTimestamp()
            });
        }
        document.getElementById('new-area-name').value = '';
        resetAreaEditor();
        fetchAreas(); // تحديث القائمة فوراً
        fetchPropertiesForAdmin();
    } catch (error) {
        console.error("Error adding area: ", error);
        alert(editingAreaId ? "حدث خطأ أثناء تعديل المنطقة." : "حدث خطأ أثناء إضافة المنطقة.");
    } finally {
        btn.disabled = false;
        btn.textContent = editingAreaId ? "حفظ التعديل" : "إضافة";
    }
});

document.getElementById('cancel-area-edit-btn')?.addEventListener('click', resetAreaEditor);

// === جلب الخدمات وعرضها ===
async function fetchServices() {
    const querySnapshot = await getDocs(collection(db, "services"));
    const servicesContainer = document.getElementById('services-container');
    const servicesList = document.getElementById('services-list');
    
    servicesContainer.innerHTML = '';
    servicesList.innerHTML = '';

    querySnapshot.forEach((serviceDoc) => {
        const data = serviceDoc.data();
        servicesContainer.innerHTML += `
            <div class="checkbox-group" style="margin-top:0;">
                <input type="checkbox" name="services" value="${serviceDoc.id}" id="srv-${serviceDoc.id}">
                <label for="srv-${serviceDoc.id}">${escapeHtml(data.name)}</label>
            </div>
        `;
        servicesList.innerHTML += `
            <li>
                <span>${escapeHtml(data.name)}</span>
                <div class="manager-actions">
                    <button class="edit-btn" data-edit-service="${serviceDoc.id}" data-name="${escapeHtml(data.name)}">تعديل</button>
                    <button class="danger-btn" data-delete-service="${serviceDoc.id}">حذف</button>
                </div>
            </li>
        `;
    });

    servicesList.querySelectorAll('[data-edit-service]').forEach((button) => {
        button.addEventListener('click', () => editService(button.dataset.editService, button.closest('li')?.querySelector('span')?.textContent || button.dataset.name || ''));
    });

    servicesList.querySelectorAll('[data-delete-service]').forEach((button) => {
        button.addEventListener('click', () => deleteService(button.dataset.deleteService));
    });
}

// === إضافة خدمة جديدة ===
document.getElementById('add-service-btn').addEventListener('click', async () => {
    const serviceName = document.getElementById('new-service-name').value.trim();
    if (!serviceName) {
        alert("يرجى كتابة اسم الخدمة أولاً");
        return;
    }
    const btn = document.getElementById('add-service-btn');
    btn.disabled = true;
    btn.textContent = "جاري الحفظ...";

    try {
        if (editingServiceId) {
            await updateDoc(doc(db, "services", editingServiceId), { name: serviceName });
        } else {
            await addDoc(collection(db, "services"), {
                name: serviceName,
                createdAt: serverTimestamp()
            });
        }
        document.getElementById('new-service-name').value = '';
        resetServiceEditor();
        fetchServices(); // تحديث القائمة فوراً
    } catch (error) {
        console.error("Error adding service: ", error);
        alert(editingServiceId ? "حدث خطأ أثناء تعديل الخدمة." : "حدث خطأ أثناء إضافة الخدمة.");
    } finally {
        btn.disabled = false;
        btn.textContent = editingServiceId ? "حفظ التعديل" : "إضافة";
    }
});

document.getElementById('cancel-service-edit-btn')?.addEventListener('click', resetServiceEditor);

async function editArea(id, currentName) {
    editingAreaId = id;
    document.getElementById('new-area-name').value = currentName;
    document.getElementById('add-area-btn').textContent = 'حفظ التعديل';
    document.getElementById('cancel-area-edit-btn').hidden = false;
    document.getElementById('new-area-name').focus();
}

function resetAreaEditor() {
    editingAreaId = null;
    document.getElementById('new-area-name').value = '';
    document.getElementById('add-area-btn').textContent = 'إضافة';
    document.getElementById('cancel-area-edit-btn').hidden = true;
}

async function deleteArea(id) {
    if (!confirm('هل تريد حذف هذه المنطقة؟')) return;

    try {
        await deleteDoc(doc(db, 'areas', id));
        await fetchAreas();
        await fetchPropertiesForAdmin();
    } catch (error) {
        console.error('Area delete error:', error);
        alert('حدث خطأ أثناء حذف المنطقة.');
    }
}

async function editService(id, currentName) {
    editingServiceId = id;
    document.getElementById('new-service-name').value = currentName;
    document.getElementById('add-service-btn').textContent = 'حفظ التعديل';
    document.getElementById('cancel-service-edit-btn').hidden = false;
    document.getElementById('new-service-name').focus();
}

function resetServiceEditor() {
    editingServiceId = null;
    document.getElementById('new-service-name').value = '';
    document.getElementById('add-service-btn').textContent = 'إضافة';
    document.getElementById('cancel-service-edit-btn').hidden = true;
}

async function deleteService(id) {
    if (!confirm('هل تريد حذف هذه الخدمة؟')) return;

    try {
        await deleteDoc(doc(db, 'services', id));
        await fetchServices();
    } catch (error) {
        console.error('Service delete error:', error);
        alert('حدث خطأ أثناء حذف الخدمة.');
    }
}

// === تهيئة الخريطة (Leaflet) ===
function initMap() {
    map = L.map('map').setView([31.836, 47.144], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    map.on('click', function(e) {
        setMarker(e.latlng.lat, e.latlng.lng);
    });
}

function setMarker(lat, lng) {
    if (marker) {
        map.removeLayer(marker);
    }
    marker = L.marker([lat, lng]).addTo(map);
    document.getElementById('prop-lat').value = lat;
    document.getElementById('prop-lng').value = lng;
}

// === جلب الموقع الحالي ===
document.getElementById('get-current-location-btn').addEventListener('click', () => {
    if (navigator.geolocation) {
        const btn = document.getElementById('get-current-location-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = "جاري تحديد الموقع...";
        
        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 16);
            setMarker(lat, lng);
            btn.innerHTML = originalText;
        }, (error) => {
            alert('تعذر الوصول إلى موقعك. يرجى تفعيل صلاحية الموقع (Location) في متصفحك.');
            btn.innerHTML = originalText;
        });
    } else {
        alert('متصفحك لا يدعم ميزة تحديد الموقع.');
    }
});

// === إضافة عقار جديد ===
document.getElementById('property-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-prop-btn');
    
    // التحقق من تحديد الموقع على الخريطة
    const lat = document.getElementById('prop-lat').value;
    const lng = document.getElementById('prop-lng').value;
    
    if (!lat || !lng) {
        alert("يرجى تحديد موقع العقار على الخريطة بالنقر عليها أو باستخدام زر تحديد موقعي الحالي.");
        return;
    }

    btn.textContent = "جاري الرفع... يرجى الانتظار";
    btn.disabled = true;

    try {
        // 1. رفع الصور واسترجاع الروابط
        const fileInput = document.getElementById('property-images');
        const imageUrls = getImageLinksFromTextarea();

        for (let i = 0; i < fileInput.files.length; i++) {
            btn.textContent = `جاري رفع الصورة ${i + 1} من ${fileInput.files.length}...`;
            const url = await uploadImageToStorage(fileInput.files[i]);
            imageUrls.push(url);
        }

        if (imageUrls.length === 0) {
            alert("يرجى اختيار صورة أو وضع رابط صورة واحد على الأقل.");
            return;
        }

        // 2. تجميع الخدمات المحددة
        const selectedServices = [];
        document.querySelectorAll('input[name="services"]:checked').forEach(checkbox => {
            selectedServices.push(checkbox.value);
        });

        // 3. حفظ البيانات في Firestore مع الموقع الجغرافي
        const propertyData = {
            propertyNumber: document.getElementById('prop-number').value || "بدون رقم",
            title: document.getElementById('prop-title').value,
            description: document.getElementById('prop-desc').value,
            type: document.getElementById('prop-type').value,
            areaId: document.getElementById('prop-area').value,
            phone: document.getElementById('prop-phone')?.value || '',
            whatsapp: document.getElementById('prop-phone')?.value || '',
            dimensions: document.getElementById('prop-dimensions').value,
            space: Number(document.getElementById('prop-space').value),
            price: Number(document.getElementById('prop-price').value),
            officeCommission: Number(document.getElementById('prop-office-commission')?.value || 0),
            commissionNote: document.getElementById('prop-commission-note')?.value || '',
            negotiable: document.getElementById('prop-negotiable').checked,
            status: document.getElementById('prop-status')?.value || "متاح",
            isFeatured: document.getElementById('prop-featured').checked,
            images: imageUrls,
            services: selectedServices,
            location: { lat: parseFloat(lat), lng: parseFloat(lng) }
        };

        if (editingPropertyId) {
            await updateDoc(doc(db, "properties", editingPropertyId), propertyData);
        } else {
            await addDoc(collection(db, "properties"), {
                ...propertyData,
                viewsCount: 0,
                createdAt: serverTimestamp()
            });
        }

        alert(editingPropertyId ? "تم تعديل العقار بنجاح!" : "تم إضافة العقار بنجاح!");
        resetPropertyForm();
        if (marker) map.removeLayer(marker);
        document.getElementById('prop-lat').value = '';
        document.getElementById('prop-lng').value = '';
        fetchPropertiesForAdmin();
        
    } catch (error) {
        console.error("Error adding document: ", error);
        alert("حدث خطأ أثناء الإضافة:\n" + getFriendlyError(error));
    } finally {
        btn.textContent = "حفظ ونشر الإعلان";
        btn.disabled = false;
    }
});

document.getElementById('cancel-edit-btn')?.addEventListener('click', () => {
    resetPropertyForm();
});

document.getElementById('refresh-properties-btn')?.addEventListener('click', fetchPropertiesForAdmin);

document.getElementById('banner-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = document.getElementById('save-banner-btn');
    const fileInput = document.getElementById('banner-image');
    const urlInput = document.getElementById('banner-image-url');
    const imageUrlFromInput = urlInput.value.trim();

    btn.disabled = true;
    btn.textContent = 'جاري حفظ البنر...';

    try {
        let imageUrl = imageUrlFromInput;
        if (!imageUrl && fileInput.files.length > 0) {
            imageUrl = await uploadFileToBunny(fileInput.files[0], 'banners');
        }

        if (!imageUrl) {
            alert('اختر صورة بنر أو ضع رابط صورة.');
            return;
        }

        await addDoc(collection(db, 'banners'), {
            imageUrl,
            createdAt: serverTimestamp()
        });

        document.getElementById('banner-form').reset();
        await fetchBannersForAdmin();
        alert('تمت إضافة البنر بنجاح.');
    } catch (error) {
        console.error('Banner save error:', error);
        alert('حدث خطأ أثناء حفظ البنر:\n' + getFriendlyError(error));
    } finally {
        btn.disabled = false;
        btn.textContent = 'إضافة بنر';
    }
});

function resetPropertyForm() {
    editingPropertyId = null;
    editingPropertyImages = [];
    document.getElementById('property-form').reset();
    document.getElementById('save-prop-btn').textContent = 'حفظ ونشر الإعلان';
    document.getElementById('cancel-edit-btn').hidden = true;
}

async function fetchPropertiesForAdmin() {
    const list = document.getElementById('properties-list');
    if (!list) return;

    list.textContent = 'جاري تحميل العقارات...';
    try {
        const querySnapshot = await getDocs(collection(db, 'properties'));
        savedProperties = [];
        querySnapshot.forEach((item) => savedProperties.push({ id: item.id, ...item.data() }));
        savedProperties.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderPropertiesForAdmin();
    } catch (error) {
        console.error('Properties load error:', error);
        list.textContent = 'تعذر تحميل العقارات.';
    }
}

function renderPropertiesForAdmin() {
    const list = document.getElementById('properties-list');
    if (!list) return;

    if (savedProperties.length === 0) {
        list.innerHTML = '<p class="manager-meta">لا توجد عقارات محفوظة حاليا.</p>';
        return;
    }

    list.innerHTML = savedProperties.map((property) => {
        const image = getFirstImage(property);
        return `
            <article class="manager-card">
                <div class="manager-thumb" style="background-image:url('${escapeHtml(image)}')"></div>
                <div>
                    <div class="manager-title">${escapeHtml(property.title || 'عقار بدون عنوان')}</div>
                    <div class="manager-meta">
                        رقم العقار: ${escapeHtml(property.propertyNumber || 'بدون رقم')}<br>
                        الحالة: ${escapeHtml(property.status || 'متاح')} | واتساب: ${escapeHtml(property.phone || property.whatsapp || 'غير محفوظ')}
                    </div>
                </div>
                <div class="manager-actions">
                    <button class="edit-btn" data-edit-property="${property.id}">تعديل</button>
                    <button class="danger-btn" data-delete-property="${property.id}">حذف</button>
                </div>
            </article>
        `;
    }).join('');

    list.querySelectorAll('[data-edit-property]').forEach((button) => {
        button.addEventListener('click', () => startEditProperty(button.dataset.editProperty));
    });

    list.querySelectorAll('[data-delete-property]').forEach((button) => {
        button.addEventListener('click', () => deleteProperty(button.dataset.deleteProperty));
    });
}

function startEditProperty(id) {
    try {
        const property = savedProperties.find((item) => item.id === id);
        if (!property) {
            alert('لم يتم العثور على بيانات هذا العقار. اضغط تحديث القائمة ثم حاول مرة ثانية.');
            return;
        }

        document.querySelector('.tab-btn[data-target="add-property"]')?.click();

        editingPropertyId = id;
        editingPropertyImages = Array.isArray(property.images) ? property.images : [];
        setFieldValue('prop-title', property.title || '');
        setFieldValue('prop-number', property.propertyNumber || '');
        setFieldValue('prop-phone', property.phone || property.whatsapp || property.phoneNumber || '');
        setSelectValue('prop-status', property.status || 'متاح');
        setSelectValue('prop-type', property.type || '');
        setSelectValue('prop-area', property.areaId || '');
        setFieldValue('prop-price', property.price || '');
        setFieldValue('prop-office-commission', property.officeCommission || property.commission || '');
        setFieldChecked('prop-negotiable', Boolean(property.negotiable));
        setFieldValue('prop-space', property.space || '');
        setFieldValue('prop-dimensions', property.dimensions || '');
        setFieldValue('prop-desc', property.description || '');
        setFieldValue('prop-commission-note', property.commissionNote || property.officeCommissionNote || '');
        setFieldChecked('prop-featured', Boolean(property.isFeatured));
        setFieldValue('property-image-links', editingPropertyImages.join('\n'));
        setSelectedServices(property.services);

        const lat = Number(property.location?.lat);
        const lng = Number(property.location?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            setFieldValue('prop-lat', lat);
            setFieldValue('prop-lng', lng);
            if (map) {
                map.setView([lat, lng], 15);
                setMarker(lat, lng);
            }
        }

        document.getElementById('save-prop-btn').textContent = 'حفظ التعديل';
        document.getElementById('cancel-edit-btn').hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        console.error('Start edit property error:', error);
        alert('تعذر فتح التعديل لهذا العقار. أرسل لي صورة الخطأ إذا تكرر.');
    }
}

function setFieldValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
}

function setFieldChecked(id, checked) {
    const element = document.getElementById(id);
    if (element) element.checked = checked;
}

function setSelectedServices(services) {
    const selectedServices = new Set(Array.isArray(services) ? services.map(String) : []);
    document.querySelectorAll('input[name="services"]').forEach((checkbox) => {
        checkbox.checked = selectedServices.has(String(checkbox.value));
    });
}

function setSelectValue(id, value) {
    const element = document.getElementById(id);
    if (!element || !value) return;
    element.value = value;
}

async function deleteProperty(id) {
    if (!confirm('هل تريد حذف هذا العقار؟')) return;
    await deleteDoc(doc(db, 'properties', id));
    await fetchPropertiesForAdmin();
}

async function fetchBannersForAdmin() {
    const list = document.getElementById('banners-list');
    if (!list) return;

    list.textContent = 'جاري تحميل البنرات...';
    try {
        const querySnapshot = await getDocs(collection(db, 'banners'));
        savedBanners = [];
        querySnapshot.forEach((item) => savedBanners.push({ id: item.id, ...item.data() }));
        savedBanners.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderBannersForAdmin();
    } catch (error) {
        console.error('Banners load error:', error);
        list.textContent = 'تعذر تحميل البنرات.';
    }
}

function renderBannersForAdmin() {
    const list = document.getElementById('banners-list');
    if (!list) return;

    if (savedBanners.length === 0) {
        list.innerHTML = '<p class="manager-meta">لا توجد بنرات محفوظة حاليا.</p>';
        return;
    }

    list.innerHTML = savedBanners.map((banner) => `
        <article class="manager-card">
            <div class="manager-thumb banner-thumb" style="background-image:url('${escapeHtml(banner.imageUrl || '')}')"></div>
            <div>
                <div class="manager-title">بنر إعلاني</div>
                <div class="manager-meta">${escapeHtml(banner.imageUrl || '')}</div>
            </div>
            <div class="manager-actions">
                <button class="danger-btn" data-delete-banner="${banner.id}">حذف</button>
            </div>
        </article>
    `).join('');

    list.querySelectorAll('[data-delete-banner]').forEach((button) => {
        button.addEventListener('click', () => deleteBanner(button.dataset.deleteBanner));
    });
}

async function deleteBanner(id) {
    if (!confirm('هل تريد حذف هذا البنر؟')) return;
    await deleteDoc(doc(db, 'banners', id));
    await fetchBannersForAdmin();
}

function getFirstImage(property) {
    if (Array.isArray(property.images) && property.images.length > 0) return property.images[0];
    return property.image || '';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// تهيئة البيانات عند فتح الصفحة
window.onload = () => {
    fetchAreas();
    fetchServices();
    fetchPropertiesForAdmin();
    fetchBannersForAdmin();
    initMap();
};
