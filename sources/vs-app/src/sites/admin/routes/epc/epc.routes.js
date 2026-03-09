angular.module('vs-admin').config(function($stateProvider) {
  return $stateProvider.state('admin_epc', {
    url: '/admin/epc',
    template: '<admin-epc></admin-epc>',
    data: {
      title: 'Vitalspace Admin - EPC Management',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})