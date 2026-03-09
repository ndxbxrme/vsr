angular.module('vs-admin').config(function($stateProvider) {
  return $stateProvider.state('admin_windows', {
    url: '/admin/windows',
    template: '<admin-windows></admin-windows>',
    data: {
      title: 'Vitalspace Admin - Windows Management',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})