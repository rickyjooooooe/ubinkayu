import React from 'react'
import { Input } from './Input'
import { Button } from './Button'
import * as apiService from '../apiService'

interface AddProductModalProps {
  isOpen: boolean
  onClose: () => void
  onSaveSuccess: () => void
}

// v-- KATA KUNCI 'export' DITAMBAHKAN DI SINI --v
export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  onSaveSuccess
}) => {
  const [productData, setProductData] = React.useState({
    product_name: '',
    wood_type: '',
    profile: '',
    color: '',
    finishing: '',
    sample: '',
    marketing: ''
  })
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!isOpen) {
      setProductData({
        product_name: '',
        wood_type: '',
        profile: '',
        color: '',
        finishing: '',
        sample: '',
        marketing: ''
      })
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setProductData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSave = async () => {
    if (!productData.product_name.trim()) {
      alert('Nama Produk wajib diisi.')
      return
    }
    setIsSaving(true)
    try {
      const result = await apiService.addNewProduct(productData)
      if (result.success) {
        alert('Produk baru berhasil disimpan!')
        onSaveSuccess()
        onClose()
      } else {
        throw new Error(result.error || 'Terjadi kesalahan di server.')
      }
    } catch (error) {
      alert(`Gagal menyimpan produk: ${(error as Error).message}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Tambah Produk Master Baru</h3>
          <button className="modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <Input
              label="Nama Produk *"
              name="product_name"
              value={productData.product_name}
              onChange={handleInputChange}
              placeholder="e.g., W Panel"
            />
            <Input
              label="Jenis Kayu"
              name="wood_type"
              value={productData.wood_type}
              onChange={handleInputChange}
              placeholder="e.g., Ulin"
            />
            <Input
              label="Profil"
              name="profile"
              value={productData.profile}
              onChange={handleInputChange}
              placeholder="e.g., Bevel"
            />
            <Input
              label="Warna"
              name="color"
              value={productData.color}
              onChange={handleInputChange}
              placeholder="e.g., Natural"
            />
            <Input
              label="Finishing"
              name="finishing"
              value={productData.finishing}
              onChange={handleInputChange}
              placeholder="e.g., Doff / Matt"
            />
            <Input
              label="Sample"
              name="sample"
              value={productData.sample}
              onChange={handleInputChange}
              placeholder="e.g., Ada sample"
            />
            <Input
              label="Marketing"
              name="marketing"
              value={productData.marketing}
              onChange={handleInputChange}
              placeholder="e.g., Michael DS"
            />
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Menyimpan...' : 'Simpan Produk'}
          </Button>
        </div>
      </div>
    </div>
  )
}
