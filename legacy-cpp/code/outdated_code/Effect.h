/*
 * File:   Effect.h
 * Author: Exiiile
 *
 * Created on June 20, 2012, 1:53 PM
 */

#ifndef _EFFECT_H
#define _EFFECT_H

#include <libtcod/libtcod.hpp>
#include "Drawable.h"
#include <string>
using namespace std;
class Effect : public Drawable {
    private:

    public:
        Effect(int x, int y, int c);
        Effect(int c, TCODColor fore, TCODColor back, bool trans, bool walk);
        Effect(int x, int y, int c, TCODColor fore, TCODColor back, bool trans, bool walk, string type);
        virtual ~Effect();
};

#endif	/* _EFFECT_H */

