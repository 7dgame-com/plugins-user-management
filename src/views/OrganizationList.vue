<template>
  <div class="organization-list">
    <div class="page-toolbar">
      <h3 class="page-title">{{ t('organization.title') }}</h3>
      <el-button type="primary" @click="openCreateDialog">
        {{ t('organization.addTitle') }}
      </el-button>
    </div>

    <div v-if="loadError" class="error-banner">{{ loadError }}</div>

    <el-card shadow="never" class="table-card">
      <el-table :data="organizations" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="100" />
        <el-table-column prop="title" :label="t('organization.organizationTitle')" min-width="180" />
        <el-table-column prop="name" :label="t('organization.organizationName')" min-width="180" />
        <el-table-column :label="t('common.actions')" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">
              {{ t('common.edit') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form label-position="top">
        <el-form-item :label="t('organization.organizationTitle')">
          <el-input
            v-model="form.title"
            :placeholder="t('organization.organizationTitlePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('organization.organizationName')">
          <el-input
            v-model="form.name"
            :disabled="isEdit"
            :placeholder="t('organization.organizationNamePlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ t('common.confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  createOrganization,
  listOrganizations,
  updateOrganization,
  type OrganizationItem,
} from '../api'

const { t } = useI18n()

const loading = ref(false)
const submitting = ref(false)
const dialogVisible = ref(false)
const mode = ref<'create' | 'edit'>('create')
const loadError = ref('')
const organizations = ref<OrganizationItem[]>([])

const form = reactive<{
  id: number | null
  title: string
  name: string
}>({
  id: null,
  title: '',
  name: '',
})

const isEdit = computed(() => mode.value === 'edit')
const dialogTitle = computed(() => t(isEdit.value ? 'organization.editTitle' : 'organization.addTitle'))

function resetForm() {
  form.id = null
  form.title = ''
  form.name = ''
}

async function fetchOrganizations() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await listOrganizations()
    if (data.code === 0 && Array.isArray(data.data)) {
      organizations.value = data.data
      return
    }

    organizations.value = []
    loadError.value = t('organization.messages.loadFailed')
  } catch {
    organizations.value = []
    loadError.value = t('organization.messages.loadFailed')
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  mode.value = 'create'
  resetForm()
  dialogVisible.value = true
}

function openEditDialog(organization: OrganizationItem) {
  mode.value = 'edit'
  form.id = organization.id
  form.title = organization.title
  form.name = organization.name
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!form.title.trim()) {
    ElMessage.error(t('organization.messages.titleRequired'))
    return
  }

  if (!isEdit.value && !form.name.trim()) {
    ElMessage.error(t('organization.messages.nameRequired'))
    return
  }

  submitting.value = true
  try {
    if (isEdit.value && form.id !== null) {
      await updateOrganization({
        id: form.id,
        title: form.title.trim(),
      })
    } else {
      await createOrganization({
        title: form.title.trim(),
        name: form.name.trim(),
      })
    }

    ElMessage.success(t('common.success'))
    dialogVisible.value = false
    await fetchOrganizations()
  } catch {
    ElMessage.error(t('common.failed'))
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  fetchOrganizations()
})
</script>

<style scoped>
.organization-list {
  display: grid;
  gap: var(--spacing-lg);
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-size-xl);
}

.error-banner {
  padding: var(--spacing-md);
  border-radius: var(--radius-sm);
  border: 1px solid color-mix(in srgb, var(--danger-color, #f56c6c) 25%, white);
  background: color-mix(in srgb, var(--danger-color, #f56c6c) 12%, white);
  color: var(--danger-color, #f56c6c);
}

.table-card {
  border: 1px solid var(--border-color);
}

@media (max-width: 640px) {
  .page-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
