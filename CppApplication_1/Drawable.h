/* 
 * File:   Drawable.h
 * Author: Brian
 *
 * Created on June 16, 2012, 9:29 PM
 */

#include <string.h>
#include "libtcod.hpp"
#ifndef DRAWABLE_H
#define	DRAWABLE_H
using namespace std;

class Drawable {
protected:
    int x, y, z;
    TCODColor fore, back;
    bool trans, walk;
public:
    Drawable(int, int, int);
    Drawable(int, TCODColor,TCODColor, bool, bool);
    Drawable(int, int, int, TCODColor,TCODColor,bool,bool);
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
    void draw();
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

