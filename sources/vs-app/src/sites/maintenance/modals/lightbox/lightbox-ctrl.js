var heic2any = require('heic2any');

angular.module('vs-maintenance').controller('maintenanceLightboxCtrl', function($scope, $q, data, ndxModalInstance) {
  'use strict';

  $scope.imgIndex = data;
  $scope.converting = false;

  $scope.isVideo = function(url) {
    if (!url) return false;
    var videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];
    var lowerUrl = url.toLowerCase();
    return videoExtensions.some(function(ext) { return lowerUrl.indexOf(ext) !== -1; });
  };

  var isHeic = function(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    if (lower.indexOf('.heic') !== -1 || lower.indexOf('.heif') !== -1) return true;
    try {
      var token = url.split('/download/')[1];
      if (token) {
        var decoded = JSON.parse(atob(token.split('?')[0]));
        var name = ((decoded.filename || '') + (decoded.path || '')).toLowerCase();
        return name.indexOf('.heic') !== -1 || name.indexOf('.heif') !== -1;
      }
    } catch (e) {}
    return false;
  };

  var resolveImageSrc = function(url) {
    if (!isHeic(url)) {
      $scope.imgSrc = url;
      return;
    }
    $scope.converting = true;
    $scope.imgSrc = null;
    fetch(url)
      .then(function(res) { return res.blob(); })
      .then(function(blob) {
        return heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.85 });
      })
      .then(function(converted) {
        $scope.$apply(function() {
          $scope.imgSrc = URL.createObjectURL(converted);
          $scope.converting = false;
        });
      })
      .catch(function() {
        $scope.$apply(function() {
          $scope.imgSrc = url;
          $scope.converting = false;
        });
      });
  };

  $scope.selectImage = function(url) {
    resolveImageSrc(url);
  };

  $scope.cancel = function() {
    return ndxModalInstance.dismiss();
  };

  resolveImageSrc(data[0].URL);
});
