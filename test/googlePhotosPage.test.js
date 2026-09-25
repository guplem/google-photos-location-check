import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAlbumPhotoUrl,
  isAlbumContext,
  readAlbumKey,
  readGooglePhotosLocation,
  readPhotoKey,
  replacePhotoKey,
} from '../src/googlePhotosPage.js';

test('reads the photo id from a photo URL', () => {
  assert.equal(readPhotoKey('https://photos.google.com/photo/AF1QipABC123'), 'AF1QipABC123');
  assert.equal(readPhotoKey('https://photos.google.com/album/XYZ/photo/AF1QipABC123'), 'AF1QipABC123');
  assert.equal(readPhotoKey('https://photos.google.com/share/S1/photo/P1?key=k'), 'P1');
});

test('returns null when the URL has no photo', () => {
  assert.equal(readPhotoKey('https://photos.google.com/album/XYZ'), null);
  assert.equal(readPhotoKey('https://photos.google.com/'), null);
});

test('reads the album id from both personal and shared albums', () => {
  assert.equal(readAlbumKey('https://photos.google.com/album/XYZ'), 'XYZ');
  assert.equal(readAlbumKey('https://photos.google.com/share/S1?key=k'), 'S1');
});

test('handles the profile prefix of a second Google account', () => {
  const location = readGooglePhotosLocation('https://photos.google.com/u/1/album/XYZ/photo/P1');
  assert.deepEqual(location, { kind: 'photo-in-album', albumKey: 'XYZ', photoKey: 'P1' });
});

test('classifies every page kind', () => {
  assert.equal(readGooglePhotosLocation('https://photos.google.com/album/XYZ').kind, 'album');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/share/S1?key=k').kind, 'album');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/album/XYZ/photo/P1').kind, 'photo-in-album');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/photo/P1').kind, 'photo');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/search/dogs').kind, 'other');
});

test('only album pages get the panel and the badges', () => {
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/album/XYZ')), true);
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/share/S1/photo/P1')), true);
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/photo/P1')), false);
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/')), false);
});

test('swaps one photo for another and keeps the rest of the URL', () => {
  assert.equal(
    replacePhotoKey('https://photos.google.com/album/XYZ/photo/P1', 'P2'),
    'https://photos.google.com/album/XYZ/photo/P2',
  );
  assert.equal(
    replacePhotoKey('https://photos.google.com/u/1/album/XYZ/photo/P1', 'P2'),
    'https://photos.google.com/u/1/album/XYZ/photo/P2',
  );
  assert.equal(
    replacePhotoKey('https://photos.google.com/share/S1/photo/P1?key=k', 'P2'),
    'https://photos.google.com/share/S1/photo/P2?key=k',
  );
});

test('refuses to swap the photo of a URL that names none', () => {
  assert.equal(replacePhotoKey('https://photos.google.com/album/XYZ', 'P2'), null);
});

test('builds the link to a photo of the album, from the grid or from a photo', () => {
  assert.equal(buildAlbumPhotoUrl('https://photos.google.com/album/XYZ', 'P2'), 'https://photos.google.com/album/XYZ/photo/P2');
  assert.equal(
    buildAlbumPhotoUrl('https://photos.google.com/u/1/album/XYZ/photo/P1', 'P2'),
    'https://photos.google.com/u/1/album/XYZ/photo/P2',
  );
  assert.equal(
    buildAlbumPhotoUrl('https://photos.google.com/share/S1?key=k', 'P2'),
    'https://photos.google.com/share/S1/photo/P2?key=k',
  );
});

test('builds no photo link for a page outside an album', () => {
  assert.equal(buildAlbumPhotoUrl('https://photos.google.com/', 'P2'), null);
  assert.equal(buildAlbumPhotoUrl('https://photos.google.com/photo/P1', 'P2'), null);
});
