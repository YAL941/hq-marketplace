import { useAuth } from '../../context/AuthContext';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Badge } from '../components/common/Badge';
import { Avatar } from '../components/layout/Avatar';
import { cn, formatCurrency } from '../../lib/utils';
import { User, Building2, Bell, Shield, Palette, Globe, Save, Camera, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export function DashboardSettingsPage() {
  const { currentBusiness, user, businesses, setCurrentBusiness } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [businessData, setBusinessData] = useState({
    businessName: '',
    businessDescription: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    city: '',
    district: '',
  });
  const [saving, setSaving] = useState(false);

  const tabs = [
    { id: 'profile', label: 'Business Profile', icon: Building2 },
    { id: 'account', label: 'Account Settings', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'team', label: 'Team Members', icon: Users },
  ];

  if (!currentBusiness) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-16">
          <Building2 className="w-16 h-16 text-navy-300 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-900 mb-2">No Business Selected</h1>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    // In real app, call businessApi.update()
    await new Promise(r => setTimeout(r, 1000));
    setSaving(false);
    alert('Settings saved successfully!');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Settings</h1>
        <p className="text-navy-500">Manage your business settings and preferences</p>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1">
          <Card className="p-0">
            <nav className="space-y-1 p-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-button text-sm font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900'
                  )}
                >
                  <tab.icon className="w-5 h-5 flex-shrink-0" />
                  {tab.label}
                </button>
              ))}
              <hr className="my-2 border-navy-200" />
              <div className="px-3 py-2">
                <p className="text-xs font-medium text-navy-500 uppercase tracking-wide mb-2">Business Switcher</p>
                <div className="space-y-1">
                  {businesses.map((biz) => (
                    <button
                      key={biz.business_id}
                      onClick={() => setCurrentBusiness(biz)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-button text-sm transition-colors',
                        currentBusiness.business_id === biz.business_id
                          ? 'bg-primary-50 text-primary-600'
                          : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900'
                      )}
                    >
                      <div className="w-7 h-7 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-4 h-4 text-primary-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-navy-900 truncate">{biz.business_name}</p>
                        <p className="text-xs text-navy-500 capitalize">{biz.role_key.replace('business_', '')}</p>
                      </div>
                      {currentBusiness.business_id === biz.business_id && (
                        <CheckCircle className="w-4 h-4 text-primary-600" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </nav>
          </Card>
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeTab === 'profile' && (
            <Card>
              <div className="p-6 border-b border-navy-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-navy-900">Business Profile</h2>
                <Button onClick={handleSave} loading={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Changes
                </Button>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-xl bg-primary-100 flex items-center justify-center overflow-hidden">
                      {currentBusiness.logo_url ? (
                        <img src={currentBusiness.logo_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Building2 className="w-12 h-12 text-primary-400" />
                      )}
                    </div>
                    <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center cursor-pointer hover:bg-primary-700">
                      <Camera className="w-4 h-4" />
                      <input type="file" className="sr-only" accept="image/*" />
                    </label>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-navy-900">Business Logo</h3>
                    <p className="text-sm text-navy-500">Upload a logo for your business (max 2MB, PNG/JPG)</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <Input
                    label="Business Name"
                    value={businessData.businessName || currentBusiness.business_name}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, businessName: e.target.value }))}
                    placeholder="Enter business name"
                  />
                  <Input
                    label="Phone"
                    type="tel"
                    value={businessData.phone || currentBusiness.phone || ''}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+252 61 234 5678"
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={businessData.email || currentBusiness.email || ''}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="business@example.com"
                  />
                  <Input
                    label="Website"
                    type="url"
                    value={businessData.website || currentBusiness.website || ''}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, website: e.target.value }))}
                    placeholder="https://example.com"
                  />
                </div>

                <Input
                  label="Description"
                  value={businessData.businessDescription || currentBusiness.business_description || ''}
                  onChange={(e) => setBusinessData(prev => ({ ...prev, businessDescription: e.target.value }))}
                  placeholder="Describe your business..."
                  className="min-h-[100px]"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Input
                    label="Address"
                    value={businessData.address || currentBusiness.address || ''}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Street address"
                    className="lg:col-span-2"
                  />
                  <Input
                    label="City"
                    value={businessData.city || currentBusiness.city || ''}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="City"
                  />
                  <Input
                    label="District"
                    value={businessData.district || currentBusiness.district || ''}
                    onChange={(e) => setBusinessData(prev => ({ ...prev, district: e.target.value }))}
                    placeholder="District"
                  />
                </div>
              </div>
            </Card>
          )}

          {activeTab === 'account' && (
            <Card>
              <div className="p-6 border-b border-navy-200">
                <h2 className="text-lg font-semibold text-navy-900">Account Settings</h2>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar name={user?.full_name || 'User'} size="lg" />
                  <div>
                    <h3 className="font-semibold text-navy-900">{user?.full_name}</h3>
                    <p className="text-navy-500">{user?.email}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <Input label="Full Name" value={user?.full_name || ''} disabled />
                  <Input label="Email" type="email" value={user?.email || ''} disabled />
                </div>
                <hr className="border-navy-200" />
                <Button variant="outline">Change Password</Button>
              </div>
            </Card>
          )}

          {activeTab === 'team' && (
            <Card>
              <div className="p-6 border-b border-navy-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-navy-900">Team Members</h2>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Invite Member
                </Button>
              </div>
              <div className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-navy-500 border-b border-navy-200">
                        <th className="pb-3 font-medium text-navy-700">Member</th>
                        <th className="pb-3 font-medium text-navy-700">Role</th>
                        <th className="pb-3 font-medium text-navy-700">Status</th>
                        <th className="pb-3 font-medium text-navy-700">Joined</th>
                        <th className="pb-3 font-medium text-navy-700 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      <tr className="hover:bg-navy-50">
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={user?.full_name || 'User'} size="sm" />
                            <div>
                              <p className="font-medium text-navy-900">{user?.full_name}</p>
                              <p className="text-sm text-navy-500">{user?.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4">
                          <Badge variant="info">Owner</Badge>
                        </td>
                        <td className="py-4">
                          <Badge variant="success">Active</Badge>
                        </td>
                        <td className="py-4 text-navy-500">Just now</td>
                        <td className="py-4 text-right">
                          <Button variant="ghost" size="sm">Edit</Button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          )}

          {['notifications', 'security', 'appearance'].includes(activeTab) && (
            <Card>
              <div className="p-6 border-b border-navy-200">
                <h2 className="text-lg font-semibold text-navy-900 capitalize">{activeTab}</h2>
              </div>
              <div className="p-6 text-center text-navy-500">
                <p>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} settings coming soon</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}