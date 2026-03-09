'use strict';

angular.module('vs-lettings').controller('lettingsAgreedPropertiesCtrl', function($scope, $state, $http, data, ndxModalInstance) {
  $scope.month = data.month;
  $scope.year = data.year;
  $scope.auth = $scope.$parent.auth || {};
  
  $scope.save = function(property) {
    if (data.save) {
      data.save(property);
    }
    property.$editing = false;
  };
  
  $scope.edit = function(property) {
    if (data.edit) {
      data.edit(property);
    }
  };
  
  $scope.deleteProperty = function(property) {
    if (data.deleteProperty) {
      data.deleteProperty(property);
    }
  };
  
  $scope.cancelEdit = function(property) {
    if (data.cancelEdit) {
      data.cancelEdit(property);
    }
  };
  
  $scope.cancel = function() {
    ndxModalInstance.dismiss();
  };

  $scope.getRoleId = function(property) {
    if (!property) return null;

    var direct =
      property.roleId ||
      property.RoleId ||
      property.roleID ||
      property.roleid ||
      (property.property && (property.property.RoleId || property.property.roleId)) ||
      (property.Property && (property.Property.RoleId || property.Property.roleId)) ||
      (property.$case && property.$case.item && (property.$case.item.RoleId || property.$case.item.roleId)) ||
      null;
    if (direct) return direct;

    var id = property._id;
    if (typeof id === 'string') {
      var match = id.match(/^(\d+)_/);
      if (match) return +match[1];
      if (/^\d+$/.test(id)) return +id;
    }
    return null;
  };

  $scope.goToCase = function(property) {
    var roleId = $scope.getRoleId(property);
    if (!roleId) return;
    ndxModalInstance.dismiss();
    $state.go('lettings_case', { roleId: roleId });
  };
});
