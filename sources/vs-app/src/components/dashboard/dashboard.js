import './dashboard.css';
angular.module('vs-app')
.config(($stateProvider) => $stateProvider.state('dashboard', {
  url: '/?view',
  params: {
    view: {
      value: null,
      squash: true
    }
  },
  template: require('../../sites/main/dashboard/dashboard.html').default,
  controller: 'mainDashboardCtrl',
  data: {title:'Vitalspace'}
}));