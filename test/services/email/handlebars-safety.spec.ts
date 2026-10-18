import Handlebars from 'handlebars';

describe('Handlebars dependency safety', () => {
  it('does not expose prototype constructors through an own-property lookup', () => {
    const render = Handlebars.compile('{{lookup target "constructor"}}');

    // GHSA-p8wg-vrv2-v86f: 4.7.9 returned Function here, bypassing its deny list.
    // The fixture only observes the lookup; it does not execute generated code.
    expect(render({ target: Function.prototype }, { allowProtoMethodsByDefault: true })).toBe('');
  });
});
