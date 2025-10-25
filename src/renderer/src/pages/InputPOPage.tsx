// file: src/renderer/pages/InputPOPage.tsx

import React, { useState, useEffect, useCallback } from 'react'
import { POHeader, POItem } from '../types'
import * as apiService from '../apiService'


// [BARU] Komponen Modal untuk Konfirmasi Revisi
const RevisionConfirmModal: React.FC<{
  isOpen: boolean
  onClose: () => void
  onConfirm: (reviserName: string) => void
}> = ({ isOpen, onClose, onConfirm }) => {
  const [reviserName, setReviserName] = useState('')

  if (!isOpen) return null

  const handleConfirm = () => {
    if (!reviserName.trim()) {
      alert('Nama perevisi harus diisi!')
      return
    }
    onConfirm(reviserName)
    setReviserName('') // Reset nama setelah konfirmasi
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Konfirmasi Revisi</h3>
        </div>
        <div className="modal-body">
          <p>Untuk melacak perubahan, silakan masukkan nama Anda sebagai perevisi.</p>
          <Input
            label="Nama Perevisi"
            value={reviserName}
            onChange={(e) => setReviserName(e.target.value)}
            placeholder="Masukkan nama Anda..."
          />
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleConfirm}>Konfirmasi & Simpan Revisi</Button>
        </div>
      </div>
    </div>
  )
}

// Basic Component Implementations
const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className
}) => <div className={`card-container ${className || ''}`}>{children}</div>

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({
  label,
  name,
  ...props
}) => (
  <div className="form-group">
    <label htmlFor={name}>{label}</label>
    <input id={name} name={name} {...props} />
  </div>
)

const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }> = ({
  label,
  name,
  ...props
}) => (
  <div className="form-group">
    <label htmlFor={name}>{label}</label>
    <textarea id={name} name={name} {...props} />
  </div>
)

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }> = ({
  children,
  variant,
  ...props
}) => (
  <button
    className={`btn ${variant === 'secondary' ? 'btn-secondary' : 'btn-primary'} ${variant === 'danger' ? 'btn-danger' : ''}`}
    {...props}
  >
    {children}
  </button>
)

const AddProductModal: React.FC<{
  isOpen: boolean
  onClose: () => void
  onSaveSuccess: () => void
}> = ({ isOpen, onClose, onSaveSuccess }) => {
  const [productData, setProductData] = useState({
    product_name: '',
    wood_type: '',
    profile: '',
    color: '',
    finishing: '',
    sample: '',
    marketing: ''
  })

  if (!isOpen) return null

  const handleSave = async () => {
    await apiService.addNewProduct(productData)
    onSaveSuccess()
    onClose()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setProductData((prev) => ({ ...prev, [name]: value }))
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Tambah Master Produk Baru</h3>
          <button onClick={onClose} className="modal-close-btn">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <Input
            label="Nama Produk"
            name="product_name"
            value={productData.product_name}
            onChange={handleChange}
          />
          <Input
            label="Tipe Kayu"
            name="wood_type"
            value={productData.wood_type}
            onChange={handleChange}
          />
          <Input
            label="Profil"
            name="profile"
            value={productData.profile}
            onChange={handleChange}
          />
          <Input label="Warna" name="color" value={productData.color} onChange={handleChange} />
          <Input
            label="Finishing"
            name="finishing"
            value={productData.finishing}
            onChange={handleChange}
          />
          <Input label="Sample" name="sample" value={productData.sample} onChange={handleChange} />
          <Input
            label="Marketing"
            name="marketing"
            value={productData.marketing}
            onChange={handleChange}
          />
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleSave}>Simpan</Button>
        </div>
      </div>
    </div>
  )
}

// --- END: Component & Service Definitions ---

interface InputPOPageProps {
  onSaveSuccess: () => void
  editingPO: POHeader | null
}

const InputPOPage: React.FC<InputPOPageProps> = ({ onSaveSuccess, editingPO }) => {
  const today = new Date().toISOString().split('T')[0]
  // Cek apakah aplikasi berjalan di Electron
  const isElectron = !!(window as any).api
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false)

  // State
  const [productList, setProductList] = useState<any[]>([])
  const [poData, setPoData] = useState({
    nomorPo: editingPO?.po_number || '',
    namaCustomer: editingPO?.project_name || '',
    tanggalMasuk: editingPO?.created_at ? editingPO.created_at.split('T')[0] : today,
    tanggalKirim: editingPO?.deadline || '',
    prioritas: editingPO?.priority || 'Normal',
    alamatKirim: (editingPO as any)?.alamatKirim || '', // Field dari Vercel
    catatan: editingPO?.notes || '',
    marketing: (editingPO as any)?.acc_marketing || '' // Field dari Vercel-2
  })
  const [items, setItems] = useState<POItem[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false)

  // State terpisah untuk foto agar bisa mendukung Electron (path) & Web (base64)
  const [poPhotoPath, setPoPhotoPath] = useState<string | null>(null)
  const [poPhotoBase64, setPoPhotoBase64] = useState<string | null>(null)

  // --- Helper Functions from Vercel-2 (Fuzzy Matching Logic) ---
  const createEmptyItem = (): POItem => ({
    id: Date.now(),
    product_id: '',
    product_name: '',
    wood_type: '',
    profile: '',
    color: '',
    finishing: '',
    sample: '',
    marketing: '',
    thickness_mm: 0,
    width_mm: 0,
    length_mm: 0,
    length_type: '',
    quantity: 1,
    satuan: 'pcs',
    location: '',
    notes: '',
    kubikasi: 0
  })

  const getUniqueOptions = (field: keyof (typeof productList)[0]) => {
    return productList
      .map((p) => p[field])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
  }

  const calculateSimilarity = (str1: string, str2: string): number => {
    const s1 = str1.toLowerCase()
    const s2 = str2.toLowerCase()
    if (s1.length === 0 && s2.length === 0) return 1.0
    if (s1.length === 0 || s2.length === 0) return 0.0
    const longer = s1.length > s2.length ? s1 : s2
    const shorter = s1.length > s2.length ? s2 : s1
    if (longer.length === 0) return 1.0
    const editDistance = getEditDistance(longer, shorter)
    return (longer.length - editDistance) / longer.length
  }

  const getEditDistance = (s1: string, s2: string): number => {
    const costs: number[] = []
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j
        } else if (j > 0) {
          let newValue = costs[j - 1]
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
          }
          costs[j - 1] = lastValue
          lastValue = newValue
        }
      }
      if (i > 0) costs[s2.length] = lastValue
    }
    return costs[s2.length]
  }

  const findBestMatch = (field: string, value: string): string => {
    if (!value || !value.trim()) return value
    const options = getUniqueOptions(field as any)
    const exactMatch = options.find((opt) => opt.toLowerCase() === value.toLowerCase())
    if (exactMatch) return exactMatch
    const matches = options
      .map((opt) => ({
        option: opt,
        similarity: calculateSimilarity(value, opt)
      }))
      .filter((m) => m.similarity >= 0.6)
      .sort((a, b) => b.similarity - a.similarity)
    return matches.length > 0 ? matches[0].option : value
  }

  // --- Data Fetching & Initialization ---
  const fetchProducts = useCallback(async () => {
    try {
      const products = await apiService.getProducts()
      setProductList(products)
    } catch (error) {
      console.error('Failed to load product list:', error)
    }
  }, [])

  useEffect(() => {
    const initialize = async () => {
      fetchProducts()
      if (editingPO) {
        setPoData({
          nomorPo: editingPO.po_number,
          namaCustomer: editingPO.project_name,
          tanggalMasuk: editingPO.created_at ? editingPO.created_at.split('T')[0] : today,
          tanggalKirim: editingPO.deadline || '',
          prioritas: editingPO.priority || 'Normal',
          alamatKirim: (editingPO as any).alamatKirim || '',
          catatan: editingPO.notes || '',
          marketing: (editingPO as any).acc_marketing || ''
        })

        if (isElectron && editingPO.photo_url) {
          setPoPhotoPath('Foto referensi dari revisi sebelumnya.')
        }

        try {
          const poItems = await apiService.listPOItems(editingPO.id)
          const itemsWithNumbers = poItems.map((item: any) => ({
            ...item,
            kubikasi: Number(item.kubikasi) || 0,
            thickness_mm: Number(item.thickness_mm) || 0,
            width_mm: Number(item.width_mm) || 0,
            length_mm: Number(item.length_mm) || 0,
            quantity: Number(item.quantity) || 1
          }))
          setItems(itemsWithNumbers)
        } catch (error) {
          console.error('Failed to load PO items:', error)
        }
      } else {
        // Reset for new PO
        setPoData({
          nomorPo: '',
          namaCustomer: '',
          tanggalMasuk: today,
          tanggalKirim: '',
          prioritas: 'Normal',
          alamatKirim: '',
          catatan: '',
          marketing: ''
        })
        setItems([createEmptyItem()])
        setPoPhotoPath(null)
        setPoPhotoBase64(null)
      }
    }
    initialize()
  }, [editingPO, isElectron, fetchProducts, today])

  // --- Event Handlers ---
  const handleDataChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setPoData((prev) => ({ ...prev, [name]: value }))
  }

  const handleDataBlur = (field: string, value: string) => {
    const correctedValue = findBestMatch(field, value)
    setPoData((prev) => ({ ...prev, [field]: correctedValue }))
  }

  // Penanganan foto yang mendukung Electron & Web
  const handleSelectPoPhoto = async () => {
    if (isElectron) {
      const selectedPath = await apiService.openFileDialog()
      if (selectedPath) {
        setPoPhotoPath(selectedPath)
      }
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          setPoPhotoPath(file.name)
          const reader = new FileReader()
          reader.onload = (readerEvent) => {
            const base64String = readerEvent.target?.result as string
            setPoPhotoBase64(base64String.split(',')[1])
          }
          reader.readAsDataURL(file)
        }
      }
      input.click()
    }
  }

  const handleCancelPoPhoto = () => {
    setPoPhotoPath(null)
    setPoPhotoBase64(null)
  }

  // --- Item Handlers ---
  const calculateKubikasi = (item: POItem) => {
    const tebal = item.thickness_mm || 0,
      lebar = item.width_mm || 0,
      panjang = item.length_mm || 0,
      qty = item.quantity || 0
    if (item.satuan === 'pcs') return (tebal * lebar * panjang * qty) / 1_000_000_000
    if (item.satuan === 'm1') return (tebal * lebar * qty) / 1_000_000
    if (item.satuan === 'm2') return (tebal * qty) / 1000
    return 0
  }

  const handleAddItem = () => {
    setItems((prev) => [...prev, createEmptyItem()])
  }

  const handleItemChange = (id: number | string, field: keyof POItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const updatedItem = { ...item, [field]: value }
          return { ...updatedItem, kubikasi: calculateKubikasi(updatedItem) }
        }
        return item
      })
    )
  }

  const handleItemBlur = (id: number | string, field: keyof POItem, value: string | number) => {
    if (typeof value !== 'string') return
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const correctedValue = findBestMatch(field, value)
          const updatedItem = { ...item, [field]: correctedValue }
          return { ...updatedItem, kubikasi: calculateKubikasi(updatedItem) }
        }
        return item
      })
    )
  }

  const handleRemoveItem = (id: number | string) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  // --- Save & Preview Logic ---
  const constructPayload = async () => {
    const itemsWithKubikasi = items.map((item) => ({ ...item, kubikasi: calculateKubikasi(item) }))
    const kubikasiTotal = itemsWithKubikasi.reduce((acc, item) => acc + (item.kubikasi || 0), 0)

    const payload: any = {
      ...poData,
      items: itemsWithKubikasi,
      kubikasi_total: kubikasiTotal,
      poId: editingPO?.id
    }

    if (isElectron && poPhotoPath) {
      payload.poPhotoPath = poPhotoPath
      if (!poPhotoPath.startsWith('Foto referensi')) {
        const base64 = await apiService.readFileAsBase64(poPhotoPath)
        if (base64) payload.poPhotoBase64 = base64
      }
    } else if (!isElectron && poPhotoBase64) {
      payload.poPhotoBase64 = poPhotoBase64
    }
    return payload
  }

  const handleSaveOrUpdatePO = async (reviserName?: string) => {
    if (!poData.nomorPo || !poData.namaCustomer)
      return alert('Nomor PO dan Nama Customer harus diisi!')
    if (items.length === 0) return alert('Tambahkan minimal satu item.')

    setIsSaving(true)
    setIsRevisionModalOpen(false)

    try {
      const payload = await constructPayload()

      if (reviserName) {
        payload.revisedBy = reviserName
      }

      const result = editingPO
        ? await apiService.updatePO(payload)
        : await apiService.saveNewPO(payload)

      if (result.success) {
        alert(`PO berhasil ${editingPO ? 'diperbarui' : 'disimpan'}!`)
        onSaveSuccess()
      } else {
        throw new Error(result.error || 'Terjadi kesalahan di backend.')
      }
    } catch (error) {
      alert(`Gagal menyimpan PO: ${(error as Error).message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handlePreviewPO = async () => {
    if (items.length === 0) return alert('Tambahkan minimal satu item untuk preview.')

    setIsPreviewing(true)
    try {
      const payload = await constructPayload()
      const result = await apiService.previewPO(payload)

      if (result.success) {
        const imageWindow = window.open()
        if (imageWindow)
          imageWindow.document.write(
            `<title>PO Preview</title><style>body{margin:0;}</style><img src="data:image/jpeg;base64,${result.base64Data}" style="width:100%;">`
          )
      } else {
        throw new Error(result.error || 'Gagal membuat data preview.')
      }
    } catch (error) {
      alert(`Gagal membuka preview PO: ${(error as Error).message}`)
    } finally {
      setIsPreviewing(false)
    }
  }

  const totalKubikasi = items.reduce((acc, item) => acc + (item.kubikasi || 0), 0)

  // --- Render JSX ---
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>{editingPO ? 'Revisi Purchase Order' : 'Input Purchase Order'}</h1>
          <p>
            {editingPO ? 'Perbarui data PO dan itemnya' : 'Buat PO baru dengan spesifikasi detail'}
          </p>
        </div>
        <div className="header-actions">
          <Button onClick={onSaveSuccess}>Kembali</Button>
          <Button variant="secondary" onClick={handlePreviewPO} disabled={isPreviewing}>
            {isPreviewing ? 'Membuka...' : '◎ Preview'}
          </Button>
          {/* [DIUBAH] Tombol simpan sekarang punya logika berbeda */}
          <Button
            onClick={() => {
              if (editingPO) {
                setIsRevisionModalOpen(true) // Jika mode revisi, buka modal
              } else {
                handleSaveOrUpdatePO() // Jika PO baru, langsung simpan
              }
            }}
            disabled={isSaving}
          >
            {isSaving ? 'Menyimpan...' : editingPO ? 'Simpan Revisi' : 'Simpan PO Baru'}
          </Button>
        </div>
      </div>

      <Card>
        <h2>Informasi Dasar PO</h2>
        <div className="form-grid">
          <Input
            label="Nomor PO *"
            name="nomorPo"
            value={poData.nomorPo}
            onChange={handleDataChange}
            placeholder="e.g., 2505.1127"
            disabled={!!editingPO}
          />
          <Input
            label="Nama Customer *"
            name="namaCustomer"
            value={poData.namaCustomer}
            onChange={handleDataChange}
            placeholder="e.g., ELIE MAGDA SBY"
          />
          <Input
            label="Tanggal Masuk"
            name="tanggalMasuk"
            type="date"
            value={poData.tanggalMasuk}
            onChange={handleDataChange}
            disabled
          />
          <Input
            label="Target Tanggal Kirim *"
            name="tanggalKirim"
            type="date"
            value={poData.tanggalKirim}
            onChange={handleDataChange}
          />
          <div className="form-group">
            <label>Prioritas</label>
            <select name="prioritas" value={poData.prioritas} onChange={handleDataChange}>
              <option value="Normal">Normal</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
          </div>
          <Input
            label="Alamat Kirim"
            name="alamatKirim"
            value={poData.alamatKirim}
            onChange={handleDataChange}
            placeholder="e.g., Jl. Industri No. 10"
          />
          <div className="form-group">
            <label>Marketing</label>
            <input
              list="marketing-list"
              name="marketing"
              value={poData.marketing}
              onChange={handleDataChange}
              onBlur={() => handleDataBlur('marketing', poData.marketing)}
              placeholder="Pilih atau ketik nama"
            />
            <datalist id="marketing-list">
              {getUniqueOptions('marketing').map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </div>
        <Textarea
          label="Catatan"
          name="catatan"
          value={poData.catatan}
          onChange={handleDataChange}
          placeholder="Catatan khusus untuk PO ini..."
          rows={3}
        />
        <div className="form-group" style={{ marginTop: '1rem' }}>
          <label>Foto Referensi PO (Opsional)</label>
          <div className="file-input-container">
            {poPhotoPath ? (
              <div className="file-preview">
                <span className="file-name" title={poPhotoPath}>
                  {poPhotoPath.split(/[/\\]/).pop()}
                </span>
                <Button
                  variant="secondary"
                  onClick={handleCancelPoPhoto}
                  className="cancel-photo-btn"
                >
                  Batal
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={handleSelectPoPhoto}>
                Pilih Foto
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="item-section-header">
        <h2>Daftar Item</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => setIsAddProductModalOpen(true)}>
            + Tambah Master Produk
          </Button>
          <Button onClick={handleAddItem}>+ Tambah Baris</Button>
        </div>
      </div>

      <Card>
        <div className="table-responsive">
          <table className="item-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Tipe Kayu</th>
                <th>Profil</th>
                <th>Warna</th>
                <th>Finishing</th>
                <th>Sample</th>
                <th>Ukuran (T x L x P)</th>
                <th>Tipe Panjang</th>
                <th>Qty</th>
                <th>Catatan Item</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ minWidth: '150px' }}>
                    <input
                      list="product-list"
                      value={item.product_name}
                      onChange={(e) => handleItemChange(item.id, 'product_name', e.target.value)}
                      onBlur={() => handleItemBlur(item.id, 'product_name', item.product_name)}
                      placeholder="Pilih/Ketik Produk"
                    />
                    <datalist id="product-list">
                      {getUniqueOptions('product_name').map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </td>
                  <td style={{ minWidth: '130px' }}>
                    <input
                      list="wood-type-list"
                      value={item.wood_type}
                      onChange={(e) => handleItemChange(item.id, 'wood_type', e.target.value)}
                      onBlur={() => handleItemBlur(item.id, 'wood_type', item.wood_type)}
                      placeholder="Pilih/Ketik Kayu"
                    />
                    <datalist id="wood-type-list">
                      {getUniqueOptions('wood_type').map((val) => (
                        <option key={val} value={val} />
                      ))}
                    </datalist>
                  </td>
                  <td style={{ minWidth: '100px' }}>
                    <input
                      list="profile-list"
                      value={item.profile}
                      onChange={(e) => handleItemChange(item.id, 'profile', e.target.value)}
                      onBlur={() => handleItemBlur(item.id, 'profile', item.profile)}
                      placeholder="Pilih/Ketik Profil"
                    />
                    <datalist id="profile-list">
                      {getUniqueOptions('profile').map((val) => (
                        <option key={val} value={val} />
                      ))}
                    </datalist>
                  </td>
                  <td style={{ minWidth: '100px' }}>
                    <input
                      list="color-list"
                      value={item.color}
                      onChange={(e) => handleItemChange(item.id, 'color', e.target.value)}
                      onBlur={() => handleItemBlur(item.id, 'color', item.color)}
                      placeholder="Pilih/Ketik Warna"
                    />
                    <datalist id="color-list">
                      {getUniqueOptions('color').map((val) => (
                        <option key={val} value={val} />
                      ))}
                    </datalist>
                  </td>
                  <td style={{ minWidth: '120px' }}>
                    <input
                      list="finishing-list"
                      value={item.finishing}
                      onChange={(e) => handleItemChange(item.id, 'finishing', e.target.value)}
                      onBlur={() => handleItemBlur(item.id, 'finishing', item.finishing)}
                      placeholder="Pilih/Ketik Finishing"
                    />
                    <datalist id="finishing-list">
                      {getUniqueOptions('finishing').map((val) => (
                        <option key={val} value={val} />
                      ))}
                    </datalist>
                  </td>
                  <td style={{ minWidth: '120px' }}>
                    <input
                      list="sample-list"
                      value={item.sample}
                      onChange={(e) => handleItemChange(item.id, 'sample', e.target.value)}
                      onBlur={() => handleItemBlur(item.id, 'sample', item.sample)}
                      placeholder="Pilih/Ketik Sample"
                    />
                    <datalist id="sample-list">
                      {getUniqueOptions('sample').map((val) => (
                        <option key={val} value={val} />
                      ))}
                    </datalist>
                  </td>
                  <td style={{ minWidth: '200px' }}>
                    <div className="size-inputs">
                      <input
                        type="number"
                        value={item.thickness_mm}
                        onChange={(e) =>
                          handleItemChange(item.id, 'thickness_mm', Number(e.target.value))
                        }
                        placeholder="T"
                      />
                      <span>x</span>
                      <input
                        type="number"
                        value={item.width_mm}
                        onChange={(e) =>
                          handleItemChange(item.id, 'width_mm', Number(e.target.value))
                        }
                        placeholder="L"
                      />
                      <span>x</span>
                      <input
                        type="number"
                        value={item.length_mm}
                        onChange={(e) =>
                          handleItemChange(item.id, 'length_mm', Number(e.target.value))
                        }
                        placeholder="P"
                      />
                    </div>
                  </td>
                  <td style={{ minWidth: '80px' }}>
                    <input
                      type="text"
                      value={item.length_type}
                      onChange={(e) => handleItemChange(item.id, 'length_type', e.target.value)}
                      placeholder="e.g. RL"
                    />
                  </td>
                  <td style={{ minWidth: '150px' }}>
                    <div className="quantity-inputs">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          handleItemChange(item.id, 'quantity', Number(e.target.value))
                        }
                        placeholder="Qty"
                      />
                      <select
                        value={item.satuan}
                        onChange={(e) => handleItemChange(item.id, 'satuan', e.target.value)}
                      >
                        <option value="pcs">pcs</option>
                        <option value="m1">m1</option>
                        <option value="m2">m2</option>
                      </select>
                    </div>
                  </td>
                  <td style={{ minWidth: '180px' }}>
                    <input
                      type="text"
                      value={item.notes}
                      onChange={(e) => handleItemChange(item.id, 'notes', e.target.value)}
                      placeholder="Catatan..."
                    />
                  </td>
                  <td>
                    <Button variant="danger" onClick={() => handleRemoveItem(item.id)}>
                      Hapus
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2>Total Kubikasi</h2>
        <p>
          <b>{totalKubikasi.toFixed(3)} m³</b>
        </p>
      </Card>

      <AddProductModal
        isOpen={isAddProductModalOpen}
        onClose={() => setIsAddProductModalOpen(false)}
        onSaveSuccess={fetchProducts}
      />

      <RevisionConfirmModal
        isOpen={isRevisionModalOpen}
        onClose={() => setIsRevisionModalOpen(false)}
        onConfirm={(name) => handleSaveOrUpdatePO(name)}
      />


    </div>
  )
}

export default InputPOPage
