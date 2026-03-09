angular.module('vs-admin').config(function($stateProvider) {
  return $stateProvider.state('admin_misdescriptions', {
    url: '/admin/misdescriptions',
    template: '<admin-misdescriptions></admin-misdescriptions>',
    data: {
      title: 'Vitalspace Admin - Property Misdescriptions',
      auth: ['superadmin', 'admin', 'agency']
    }
  });
})