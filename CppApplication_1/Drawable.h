/* 
 * File:   Drawable.h
 * Author: Brian
 *
 * Created on June 16, 2012, 9:29 PM
 */

#include <string.h>
#include <libtcod/libtcod.hpp>
#ifndef DRAWABLE_H
#define	DRAWABLE_H
using namespace std;

class Drawable {
protected:
    int x, y, z;
    TCODColor fore, back;
    bool trans, walk;
public:
    Drawable(int x, int y, int z);
    Drawable(int z, TCODColor fore,TCODColor back, bool trans, bool walk);
    Drawable(int x, int y, int z, TCODColor fore, TCODColor back,bool trans ,bool walk);
    void setX(int);
    void setY(int);
    bool moveRight();
    bool moveLeft();
    bool moveDown();
    bool moveUp();
    bool moveUpLeft();
    bool moveDownLeft();
    bool moveUpRight();
    bool moveDownRight();
    virtual void draw();
    int returnx();
    int returny();
    int returnz();
    TCODColor returnfore();
    TCODColor returnback();
    bool returnwalk();
    bool returntrans();
    virtual ~Drawable();
private:

};

#endif	/* DRAWABLE_H */

